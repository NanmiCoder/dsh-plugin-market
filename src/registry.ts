/**
 * Catalog acquisition: remote fetch with conditional requests, an on-disk
 * cache, and the seed snapshot shipped inside the package.
 *
 * Availability is layered so the marketplace is never blank: remote → cache →
 * seed. A failed refresh keeps whatever is already loaded; only a well-formed,
 * schema-compatible document ever replaces it.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isCompatible,
  type Catalog,
  type CatalogEntry,
  type CatalogSource,
  type InstallMethod,
  type Tier,
} from './types.ts'

/** The seed snapshot shipped with the package (`files` includes `assets`). */
const SEED_PATH = fileURLToPath(new URL('../assets/seed-catalog.json', import.meta.url))

/** Tier values accepted from a published catalog. */
const TIERS: readonly string[] = ['verified-npm', 'verified-git', 'likely-plugin', 'related']

/** Install methods accepted from a published catalog. */
const METHODS: readonly string[] = ['npm', 'git', 'manual']

/** How long a catalog fetch may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 20_000

/** What the registry currently holds and where it came from. */
export interface CatalogState {
  readonly catalog: Catalog
  readonly source: CatalogSource
  /** The remote published a schema newer than this build understands. */
  readonly upgradeRequired: boolean
}

/** Construction inputs for {@link CatalogRegistry}. */
export interface RegistryOptions {
  /** Published catalog URL; empty disables remote refresh entirely. */
  readonly registryUrl: string
  /** Directory for the on-disk cache. */
  readonly stateDir: string
  readonly warn: (line: string) => void
}

/**
 * Coerce an unknown value into a catalog.
 *
 * Remote data is untrusted input: a 200 with the wrong shape must be refused
 * rather than allowed to render as a broken list. Entries that fail validation
 * are dropped individually so one malformed row cannot void the whole feed.
 * @param value - parsed JSON from the network or the cache file.
 * @returns the catalog, or undefined when it is unusable.
 */
export function parseCatalog(value: unknown): Catalog | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const root = value as { meta?: unknown, entries?: unknown }
  const meta = root.meta
  if (typeof meta !== 'object' || meta === null) return undefined
  const { schemaVersion, generatedAt, count, contentHash } = meta as Record<string, unknown>
  if (typeof schemaVersion !== 'number' || typeof generatedAt !== 'string') return undefined
  if (!Array.isArray(root.entries)) return undefined
  const entries: CatalogEntry[] = []
  for (const candidate of root.entries) {
    const entry = parseEntry(candidate)
    if (entry !== undefined) entries.push(entry)
  }
  return {
    meta: {
      schemaVersion,
      generatedAt,
      count: typeof count === 'number' ? count : entries.length,
      contentHash: typeof contentHash === 'string' ? contentHash : '',
    },
    entries,
  }
}

/**
 * Validate one catalog row.
 * @param value - a single entry from the document.
 * @returns the entry, or undefined when required fields are missing.
 */
function parseEntry(value: unknown): CatalogEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const { id, repo, owner, url, tier } = row
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof repo !== 'string') return undefined
  if (typeof tier !== 'string' || !TIERS.includes(tier)) return undefined
  // The published index omits fields it can derive, to keep the document the
  // plugin fetches small; rebuild them rather than rejecting the row.
  const resolvedUrl = typeof url === 'string' ? url : `https://github.com/${repo}`
  const resolvedOwner = typeof owner === 'string' ? owner : (repo.split('/')[0] ?? '')
  const num = (key: string): number => (typeof row[key] === 'number' ? row[key] as number : 0)
  const str = (key: string): string | undefined => (typeof row[key] === 'string' ? row[key] as string : undefined)
  return {
    id,
    repo,
    owner: resolvedOwner,
    url: resolvedUrl,
    tier: tier as Tier,
    packageName: str('packageName'),
    installMethod: (typeof row.installMethod === 'string' && METHODS.includes(row.installMethod)
      ? row.installMethod
      : 'manual') as InstallMethod,
    installSpec: str('installSpec'),
    runsBuildScript: row.runsBuildScript === true,
    manualSteps: Array.isArray(row.manualSteps)
      ? row.manualSteps.filter((s): s is string => typeof s === 'string')
      : undefined,
    description: str('description') ?? '',
    summary: str('summary'),
    summaryEn: str('summaryEn'),
    category: str('category'),
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
    stars: num('stars'),
    forks: num('forks'),
    openIssues: num('openIssues'),
    closedIssues: num('closedIssues'),
    openPullRequests: num('openPullRequests'),
    commits: num('commits'),
    pushedAt: str('pushedAt') ?? '',
    createdAt: str('createdAt') ?? '',
    license: str('license'),
    language: str('language'),
    archived: row.archived === true,
    isFork: row.isFork === true,
    latestReleaseTag: str('latestReleaseTag'),
    latestReleaseAt: str('latestReleaseAt'),
    npmVersion: str('npmVersion'),
    hasClient: row.hasClient === true,
    hasSkills: row.hasSkills === true,
    needsApiKey: row.needsApiKey === true,
    score: num('score'),
    labelStale: row.labelStale === true ? true : undefined,
  }
}

/** An empty catalog, used when even the seed cannot be read. */
const EMPTY: Catalog = {
  meta: { schemaVersion: 0, generatedAt: '1970-01-01T00:00:00Z', count: 0, contentHash: '' },
  entries: [],
}

/** Holds the current catalog and refreshes it from the published source. */
export class CatalogRegistry {
  private state: CatalogState
  private etag: string | undefined
  private inFlight: Promise<CatalogState> | undefined
  private readonly cachePath: string

  constructor(private readonly options: RegistryOptions) {
    this.cachePath = join(options.stateDir, 'catalog.json')
    this.state = this.loadLocal()
  }

  /** The catalog currently served to the UI. */
  snapshot(): CatalogState {
    return this.state
  }

  /**
   * Refresh from the published URL.
   *
   * Concurrent calls share one request. Any failure — network, timeout, bad
   * shape, incompatible schema — leaves the current state untouched.
   * @returns the state after the attempt.
   */
  async refresh(): Promise<CatalogState> {
    if (this.options.registryUrl === '') return this.state
    this.inFlight ??= this.fetchOnce().finally(() => { this.inFlight = undefined })
    return this.inFlight
  }

  /**
   * Perform one conditional fetch and adopt the result when it is usable.
   * @returns the state after the attempt.
   */
  private async fetchOnce(): Promise<CatalogState> {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (this.etag !== undefined) headers['if-none-match'] = this.etag
      const response = await fetch(this.options.registryUrl, { headers, signal })
      if (response.status === 304) return this.state
      if (!response.ok) {
        this.options.warn(`plugin-hub: catalog fetch failed with HTTP ${response.status}; keeping ${this.state.source} data`)
        return this.state
      }
      const catalog = parseCatalog(await response.json())
      if (catalog === undefined) {
        this.options.warn(`plugin-hub: catalog at ${this.options.registryUrl} is malformed; keeping ${this.state.source} data`)
        return this.state
      }
      if (!isCompatible(catalog.meta)) {
        // Forward guard: refuse rather than half-parse, and tell the UI why.
        this.state = { ...this.state, upgradeRequired: true }
        this.options.warn(
          `plugin-hub: published catalog schema v${catalog.meta.schemaVersion} is newer than this build supports — update dsh-plugin-hub`,
        )
        return this.state
      }
      this.etag = response.headers.get('etag') ?? undefined
      this.state = { catalog, source: 'remote', upgradeRequired: false }
      this.writeCache(catalog)
      return this.state
    } catch (error: unknown) {
      this.options.warn(`plugin-hub: catalog refresh failed (${String(error)}); keeping ${this.state.source} data`)
      return this.state
    }
  }

  /**
   * Load the best locally available catalog: cache first, then seed.
   * @returns the initial state.
   */
  private loadLocal(): CatalogState {
    const cached = this.readJsonFile(this.cachePath)
    if (cached !== undefined && isCompatible(cached.meta)) {
      return { catalog: cached, source: 'cache', upgradeRequired: false }
    }
    const seed = this.readJsonFile(SEED_PATH)
    if (seed !== undefined) return { catalog: seed, source: 'seed', upgradeRequired: false }
    return { catalog: EMPTY, source: 'seed', upgradeRequired: false }
  }

  /**
   * Read and validate a catalog document from disk.
   * @param path - the file to read.
   * @returns the catalog, or undefined when absent or unusable.
   */
  private readJsonFile(path: string): Catalog | undefined {
    try {
      return parseCatalog(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return undefined
    }
  }

  /**
   * Persist a catalog to the cache, atomically.
   * @param catalog - the document to store.
   */
  private writeCache(catalog: Catalog): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true })
      const temporary = `${this.cachePath}.tmp`
      writeFileSync(temporary, JSON.stringify(catalog), 'utf8')
      // Rename over the target so a crash mid-write cannot truncate the cache.
      renameSync(temporary, this.cachePath)
    } catch (error: unknown) {
      this.options.warn(`plugin-hub: could not write catalog cache: ${String(error)}`)
    }
  }
}
