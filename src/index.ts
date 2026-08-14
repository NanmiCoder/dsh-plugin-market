/**
 * dsh-plugin-hub — a plugin marketplace for DeepSeek Harness.
 *
 * The host half serves a curated catalog over its own HTTP routes and performs
 * installs into the running profile. The browser half (`./client`) renders it
 * as a tab in Settings > Plugins.
 *
 * @module dsh-plugin-hub
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Installer, type LoaderLike } from './installer.ts'
import { readInstalledPackage, resolveProfileDirectory } from './profile.ts'
import { CatalogRegistry } from './registry.ts'
import { isTrustedRequest } from './request-trust.ts'
import type {
  CatalogEntry,
  CatalogEntryView,
  CatalogResponse,
  InstallState,
  MutationResponse,
} from './types.ts'

export const name = 'plugin-hub'

/**
 * Only the Loader is required. The web server is resolved lazily through
 * `ctx.get()` instead: a headless profile mounts no web server at all, and
 * naming it here would leave this plugin permanently inactive there.
 */
export const inject = ['loader']

/**
 * Route prefix owned by this plugin.
 *
 * Deliberately NOT under `/plugins/dsh-plugin-hub`: that namespace belongs to
 * the client-module registry, which serves every plugin's browser bundle from
 * `/plugins/<id>/client.js`. A prefix route registered there shadows the
 * bundle route, and the marketplace's own UI stops loading.
 */
const ROUTE_PREFIX = '/plugin-hub'

/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const

/** The web-server surface used here, kept structural to avoid a peer dependency. */
interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Plugin configuration. */
export interface Config {
  /** Published catalog URL. Empty keeps the packaged seed snapshot. */
  registryUrl?: string
  /** Background refresh interval in hours; 0 disables periodic refresh. */
  refreshIntervalHours?: number
  /** When false every mutation route refuses, whatever the UI sends. */
  allowInstall?: boolean
  /** Escape hatch for an unusual layout; normally derived from `ctx.baseUrl`. */
  profileDir?: string
}

export const Config: z<Config> = z.object({
  registryUrl: z.string().default(''),
  refreshIntervalHours: z.natural().default(6),
  allowInstall: z.boolean().default(true),
  profileDir: z.string().default(''),
})

/**
 * Mount the marketplace.
 * @param ctx - the host context.
 * @param config - the plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = {
    registryUrl: config.registryUrl ?? '',
    refreshIntervalHours: config.refreshIntervalHours ?? 6,
    allowInstall: config.allowInstall ?? true,
    profileDir: config.profileDir ?? '',
  }
  const warn = (line: string): void => { ctx.logger.warn(line) }

  const profileDir = resolveProfileDirectory(ctx.baseUrl, resolved.profileDir)
  const registry = new CatalogRegistry({
    registryUrl: resolved.registryUrl,
    stateDir: join(profileDir, '.plugin-hub'),
    warn,
  })
  const installer = new Installer({
    profileDir,
    allowInstall: resolved.allowInstall,
    loader: ctx.loader as unknown as LoaderLike,
    warn,
  })

  // Refresh once at mount, then on a timer. A failure is logged and ignored:
  // the registry keeps whatever it already holds.
  void registry.refresh()
  if (resolved.refreshIntervalHours > 0) {
    const period = resolved.refreshIntervalHours * 60 * 60 * 1000
    const timer = setInterval(() => { void registry.refresh() }, period)
    // Never hold the process open just to refresh a catalog.
    timer.unref?.()
    ctx.effect(() => () => { clearInterval(timer) }, 'plugin-hub: catalog refresh timer')
  }

  let registered = false
  const registerWebSurface = (): void => {
    if (registered) return
    const webServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebRouteHost | undefined
    if (webServer === undefined) return
    registered = true
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => handle(req, res, { registry, installer, resolved, warn }),
    }), 'plugin-hub: marketplace routes')
  }

  // The web server may be provided by a sibling row that activates after this
  // one, so try now and retry when any service appears.
  registerWebSurface()
  ctx.on('internal/service', (serviceName: string) => {
    if ((WEB_SERVER_KEYS as readonly string[]).includes(serviceName)) registerWebSurface()
  })
}

/** Everything a request handler needs. */
interface RouteDeps {
  readonly registry: CatalogRegistry
  readonly installer: Installer
  readonly resolved: { allowInstall: boolean, registryUrl: string }
  readonly warn: (line: string) => void
}

/**
 * Dispatch one marketplace request.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param deps - the plugin's collaborators.
 */
async function handle(
  req: IncomingMessage, res: ServerResponse, deps: RouteDeps,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
  const method = req.method ?? 'GET'
  try {
    if (route === '/catalog' && method === 'GET') {
      sendJson(res, 200, buildCatalogResponse(deps))
      return
    }
    if (route === '/refresh' && method === 'POST') {
      if (!guard(req, res)) return
      await deps.registry.refresh()
      sendJson(res, 200, buildCatalogResponse(deps))
      return
    }
    if (route === '/install' && method === 'POST') {
      if (!guard(req, res)) return
      await mutate(req, res, deps, 'install')
      return
    }
    if (route === '/uninstall' && method === 'POST') {
      if (!guard(req, res)) return
      await mutate(req, res, deps, 'uninstall')
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error: unknown) {
    deps.warn(`plugin-hub: ${method} ${route} failed: ${String(error)}`)
    sendJson(res, 500, { error: String(error) })
  }
}

/**
 * Refuse a mutating request that a browser would not have made same-origin.
 *
 * DSH's own Host / Fetch-Metadata / Origin fence covers `/api` only and does
 * not extend to plugin-registered routes, so it is applied explicitly here.
 * @param req - the incoming request.
 * @param res - the response, written on refusal.
 * @returns true when the request may proceed.
 */
function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (isTrustedRequest({ headers: req.headers }, [])) return true
  sendJson(res, 403, { error: 'cross-origin request refused' })
  return false
}

/**
 * Run an install or uninstall from a JSON request body.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param deps - the plugin's collaborators.
 * @param action - which mutation to perform.
 */
async function mutate(
  req: IncomingMessage, res: ServerResponse, deps: RouteDeps, action: 'install' | 'uninstall',
): Promise<void> {
  const body = await readJsonBody(req)
  if (body === undefined) {
    sendJson(res, 400, failure('request body is not valid JSON'))
    return
  }
  if (action === 'uninstall') {
    const packageName = typeof body.name === 'string' ? body.name : undefined
    if (packageName === undefined) {
      sendJson(res, 400, failure('uninstall requires a "name"'))
      return
    }
    sendJson(res, 200, await deps.installer.uninstall(packageName))
    return
  }
  const id = typeof body.id === 'string' ? body.id : undefined
  if (id === undefined) {
    sendJson(res, 400, failure('install requires an "id"'))
    return
  }
  // The client sends an id, never a spec: the spec is re-derived here from the
  // host's own catalog so a crafted request cannot hand pnpm an arbitrary
  // argument.
  const entry = deps.registry.snapshot().catalog.entries.find(candidate => candidate.id === id)
  if (entry === undefined) {
    sendJson(res, 404, failure(`${id} is not in the catalog`))
    return
  }
  sendJson(res, 200, await deps.installer.install(entry))
}

/**
 * Join the catalog with this profile's installation state.
 * @param deps - the plugin's collaborators.
 * @returns the response body for `/catalog`.
 */
function buildCatalogResponse(deps: RouteDeps): CatalogResponse {
  const state = deps.registry.snapshot()
  const installed = deps.installer.installed()
  const entries: CatalogEntryView[] = state.catalog.entries.map((entry) => {
    const version = entry.packageName === undefined ? undefined : installed.get(entry.packageName)
    return {
      ...entry,
      installState: installState(entry, version),
      installedVersion: version === '' ? undefined : version,
    }
  })
  return {
    entries,
    meta: state.catalog.meta,
    source: state.source,
    installEnabled: deps.resolved.allowInstall,
    upgradeRequired: state.upgradeRequired ? true : undefined,
  }
}

/**
 * Decide how an entry should render its action button.
 * @param entry - the catalog entry.
 * @param version - the installed version, if the package is a dependency.
 * @returns the install state.
 */
function installState(entry: CatalogEntry, version: string | undefined): InstallState {
  if (version === undefined) return 'not-installed'
  // Present as a dependency but with no resolvable package directory: pnpm
  // wrote it, the tree has not caught up, so the page needs a reload.
  return version === '' ? 'pending-reload' : 'installed'
}

/**
 * Read a JSON request body, bounded.
 * @param req - the incoming request.
 * @returns the parsed object, or undefined when unusable.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/**
 * Write a JSON response.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param body - the value to serialize.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Build a failed mutation body.
 * @param message - the reason.
 * @returns the response body.
 */
function failure(message: string): MutationResponse {
  return { ok: false, needsReload: false, message }
}

export { readInstalledPackage }
