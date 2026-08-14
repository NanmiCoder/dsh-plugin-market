/**
 * Install and uninstall plugins in the running profile.
 *
 * Two things must both happen, and they are separate mechanisms:
 *
 *  - PERSISTENCE — pnpm writes the dependency and `reconcileBundles` adds the
 *    package to `dsh.profile.bundles`, which is what the NEXT cold boot
 *    composes from.
 *  - LIVE MOUNT — `loader.create()` mounts the plugin's rows into the running
 *    tree right now. The Loader root is in-memory (its `write()` is a no-op),
 *    so these rows are never persisted and cannot collide with the bundle
 *    layer the next boot inserts.
 *
 * Doing only the first would require a restart; doing only the second would
 * lose the plugin on restart.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import {
  bundleDirectory,
  declaresClient,
  readInstalledPackage,
  readManifest,
  reconcileBundles,
} from './profile.ts'
import { INSTALLABLE_TIERS, type CatalogEntry, type MutationResponse } from './types.ts'

/** How long a single pnpm invocation may run. */
const PNPM_TIMEOUT_MS = 180_000

/** Maximum pnpm output echoed back to the UI. */
const OUTPUT_LIMIT = 4000

/** The Loader surface this plugin uses, kept structural to avoid a hard dependency. */
export interface LoaderLike {
  create(options: { name: string, config?: unknown }): Promise<string>
  remove(id: string): Promise<void>
  entries(): Iterable<{ id: string, options: { name?: string, group?: boolean | null } }>
}

/** Construction inputs for {@link Installer}. */
export interface InstallerOptions {
  readonly profileDir: string
  readonly allowInstall: boolean
  readonly loader: LoaderLike
  readonly warn: (line: string) => void
}

/**
 * Whether a pnpm package spec is safe to pass as an argument.
 *
 * Specs are re-derived host-side from the catalog and never taken from the
 * client, so this is defence in depth. The leading-dash check is the load
 * bearing one: an argument starting with `-` would be read by pnpm as a flag
 * rather than a package.
 * @param spec - the candidate spec.
 * @returns true when the spec may be handed to pnpm.
 */
export function isSafeSpec(spec: string): boolean {
  if (spec === '' || spec.length > 200) return false
  if (spec.startsWith('-')) return false
  // Registry names, scoped names, versioned names, and github:owner/repo forms.
  return /^[@a-zA-Z0-9][a-zA-Z0-9._~:/@^-]*$/.test(spec)
}

/** Runs pnpm and mounts plugin rows for one profile. */
export class Installer {
  /** Serializes every mutation: two concurrent pnpm runs would race the lockfile. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: InstallerOptions) {}

  /**
   * Install a catalog entry into the profile.
   * @param entry - the entry, as held by the host's own catalog copy.
   * @returns the outcome, including whether the page must be reloaded.
   */
  async install(entry: CatalogEntry): Promise<MutationResponse> {
    return this.serialize(async () => {
      if (!this.options.allowInstall) {
        return fail('installing is disabled by configuration (allowInstall: false)')
      }
      if (!INSTALLABLE_TIERS.includes(entry.tier)) {
        return fail(`${entry.repo} is not marked installable (tier: ${entry.tier})`)
      }
      if (entry.installMethod === 'manual') {
        // Unpublished and unbuildable by pnpm: attempting it would install a
        // package whose entry point was never compiled.
        return fail(`${entry.repo} must be installed manually — clone and build it, then add the directory`)
      }
      const spec = entry.installSpec
      if (spec === undefined || !isSafeSpec(spec)) {
        return fail(`${entry.repo} has no usable install spec`)
      }
      const before = readManifest(this.options.profileDir)
      const result = this.runPnpm(['add', spec])
      if (result.status !== 0) return fail(this.explainPnpmFailure(result, spec), result.output)

      const { added } = reconcileBundles(before, this.options.profileDir)
      if (added.length === 0) {
        return {
          ok: true,
          needsReload: false,
          message: `${spec} installed as a plain dependency — it declares no dsh.bundle, so nothing was mounted`,
        }
      }
      let needsReload = false
      for (const packageName of added) {
        needsReload = await this.mount(packageName) || needsReload
      }
      return {
        ok: true,
        needsReload,
        message: needsReload
          ? `${added.join(', ')} installed and mounted — reload the page to load its interface`
          : `${added.join(', ')} installed and mounted`,
      }
    })
  }

  /**
   * Remove a package from the profile.
   * @param packageName - the installed dependency name.
   * @returns the outcome.
   */
  async uninstall(packageName: string): Promise<MutationResponse> {
    return this.serialize(async () => {
      if (!this.options.allowInstall) {
        return fail('uninstalling is disabled by configuration (allowInstall: false)')
      }
      if (!isSafeSpec(packageName)) return fail(`${packageName} is not a valid package name`)
      const before = readManifest(this.options.profileDir)
      if (!Object.keys(before.dependencies ?? {}).includes(packageName)) {
        return fail(`${packageName} is not a dependency of this profile`)
      }
      const hadClient = declaresClient(readInstalledPackage(this.options.profileDir, packageName))
      // Unmount before pnpm deletes the files the running fibers were loaded from.
      await this.unmount(packageName)
      const result = this.runPnpm(['remove', packageName])
      if (result.status !== 0) return fail(this.explainPnpmFailure(result, packageName), result.output)
      reconcileBundles(before, this.options.profileDir)
      return {
        ok: true,
        needsReload: hadClient,
        message: hadClient
          ? `${packageName} removed — reload the page to drop its interface`
          : `${packageName} removed`,
      }
    })
  }

  /**
   * List the profile's installed dependencies with their versions.
   * @returns package name to installed version.
   */
  installed(): Map<string, string> {
    const result = new Map<string, string>()
    for (const packageName of Object.keys(readManifest(this.options.profileDir).dependencies ?? {})) {
      result.set(packageName, readInstalledPackage(this.options.profileDir, packageName)?.version ?? '')
    }
    return result
  }

  /**
   * Mount every row a newly installed bundle contributes.
   * @param packageName - the installed bundle.
   * @returns true when the bundle ships a browser half.
   */
  private async mount(packageName: string): Promise<boolean> {
    const manifest = readInstalledPackage(this.options.profileDir, packageName)
    const patch = manifest?.dsh?.bundle?.patch
    const directory = bundleDirectory(this.options.profileDir, packageName)
    if (patch === undefined || directory === undefined) return false
    try {
      for (const options of loadOverlayPatches('dsh', join(directory, patch))) {
        for (const row of options.insert ?? []) {
          const name = row.name
          if (typeof name !== 'string' || name === '') continue
          await this.options.loader.create({ name, config: row.config })
        }
      }
    } catch (error: unknown) {
      // The package is installed and reconciled; only the live mount failed,
      // so the next restart still brings it up. Say so instead of throwing.
      this.options.warn(
        `plugin-hub: ${packageName} is installed but could not be mounted live (${String(error)}) — restart dsh to load it`,
      )
    }
    return declaresClient(manifest)
  }

  /**
   * Remove every live entry a package contributed.
   *
   * Entries are matched by module name rather than by ids remembered at
   * install time, so a plugin mounted by a previous cold boot unmounts here
   * exactly like one this process installed.
   * @param packageName - the package whose rows should go.
   */
  private async unmount(packageName: string): Promise<void> {
    const ids: string[] = []
    for (const entry of this.options.loader.entries()) {
      if (entry.options.group === true) continue
      if (entry.options.name === packageName) ids.push(entry.id)
    }
    for (const id of ids.reverse()) {
      try {
        await this.options.loader.remove(id)
      } catch (error: unknown) {
        this.options.warn(`plugin-hub: could not unmount ${packageName} entry ${id}: ${String(error)}`)
      }
    }
  }

  /**
   * Run one pnpm command in the profile directory.
   *
   * `ctx.subprocess` is deliberately not used: it scrubs environment variables
   * matching /KEY|PASSWORD|SECRET|TOKEN/i, which would strip the registry
   * credentials pnpm needs for private packages.
   * @param args - pnpm arguments.
   * @returns exit status and combined output.
   */
  private runPnpm(args: readonly string[]): { status: number, output: string } {
    const result = spawnSync('pnpm', [...args], {
      cwd: this.options.profileDir,
      encoding: 'utf8',
      timeout: PNPM_TIMEOUT_MS,
      // Windows resolves pnpm through a .cmd shim, which spawn() refuses
      // without a shell since the CVE-2024-27980 hardening.
      shell: process.platform === 'win32',
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-OUTPUT_LIMIT)
    if (result.error !== undefined) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { status: 127, output }
      return { status: 1, output: `${output}\n${String(result.error)}` }
    }
    return { status: result.status ?? 1, output }
  }

  /**
   * Turn a pnpm failure into an actionable sentence.
   * @param result - the failed invocation.
   * @param spec - the spec that was being installed or removed.
   * @returns a message naming the likely fix.
   */
  private explainPnpmFailure(result: { status: number, output: string }, spec: string): string {
    if (result.status === 127) {
      return 'pnpm was not found on PATH — install pnpm to manage profile plugins'
    }
    if (/^git\+|^github:|\.git(?:#|$)/.test(spec) && /build|prepare|allowBuilds|ignored/i.test(result.output)) {
      return `${spec} builds on install through its prepare script, which pnpm blocks until it is allowed. `
        + `Add the key pnpm names above under allowBuilds in ${join(this.options.profileDir, 'pnpm-workspace.yaml')}, then retry. `
        + 'That allowance lets the package run its own code on this machine at install time.'
    }
    return `pnpm failed for ${spec}`
  }

  /**
   * Queue a mutation behind any already running one.
   * @param task - the mutation to run.
   * @returns the mutation's result.
   */
  private serialize(task: () => Promise<MutationResponse>): Promise<MutationResponse> {
    const run = this.queue.then(task, task)
    // Keep the chain alive regardless of outcome; results are returned to the caller.
    this.queue = run.catch(() => undefined)
    return run
  }
}

/**
 * Build a failed mutation response.
 * @param message - the human-facing reason.
 * @param detail - optional command output.
 * @returns the response.
 */
function fail(message: string, detail?: string): MutationResponse {
  return { ok: false, needsReload: false, message, detail }
}
