/**
 * On-demand README retrieval for the detail panel.
 *
 * READMEs are not published into the catalog. At roughly 8 KB apiece, 1984 of
 * them would add ~16 MB to a document the browser parses every time the
 * marketplace opens — and the text would be as stale as the last crawl. They
 * are fetched per entry instead, straight from the repository's default
 * branch.
 *
 * The target URL is always derived from `owner/repo` as it appears in the
 * host's own catalog. Nothing about the request comes from the browser except
 * an entry id, so this route cannot be pointed at an arbitrary host.
 */

/** Filenames tried, in order; the first that exists wins. */
const CANDIDATES = [
  'README.md', 'readme.md', 'README.zh-CN.md', 'README_CN.md', 'README.zh.md', 'README.markdown', 'README',
] as const

/** Largest README served. Beyond this the panel links out instead. */
const MAX_BYTES = 512 * 1024

/** How long one repository's fetch attempts may take in total. */
const TIMEOUT_MS = 12_000

/** Appended when a README was cut short, so the cut is visible. */
const TRUNCATED_NOTE = 'This README was truncated — open it on GitHub to read the rest.'

/** Entries held in memory before the oldest is evicted. */
const CACHE_LIMIT = 120

/** How long a cached README stays fresh. */
const CACHE_TTL_MS = 30 * 60 * 1000

/** A README that has already been fetched. */
interface CacheRow {
  readonly markdown: string
  readonly sourceUrl: string
  readonly at: number
}

/** What a lookup produced. */
export interface ReadmeResult {
  readonly markdown: string
  readonly sourceUrl?: string
  readonly message?: string
}

/**
 * Whether `owner/repo` is shaped the way GitHub spells it.
 *
 * The value comes from the host's own catalog rather than the browser, but it
 * is interpolated into a URL, so it is checked anyway: a catalog is a file on
 * disk, and a file on disk can be edited.
 * @param repo - the `owner/repo` string.
 * @returns true when safe to interpolate.
 */
export function isSafeRepo(repo: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo) && repo.length <= 140
}

/** Fetches and caches repository READMEs. */
export class ReadmeStore {
  private readonly cache = new Map<string, CacheRow>()

  constructor(private readonly warn: (line: string) => void) {}

  /**
   * Get a repository's README, from cache when it is fresh.
   * @param repo - `owner/repo` as spelled by GitHub.
   * @returns the Markdown, or a message explaining why there is none.
   */
  async get(repo: string): Promise<ReadmeResult> {
    if (!isSafeRepo(repo)) return { markdown: '', message: 'unusable repository name' }
    const hit = this.cache.get(repo)
    if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) {
      return { markdown: hit.markdown, sourceUrl: hit.sourceUrl }
    }
    const found = await this.fetchFirst(repo)
    if (found === undefined) return { markdown: '', message: 'no README found in this repository' }
    this.remember(repo, found)
    return { markdown: found.markdown, sourceUrl: found.sourceUrl }
  }

  /**
   * Try each candidate filename until one returns content.
   *
   * `HEAD` resolves to whatever the default branch is, so neither the branch
   * name nor a redirect needs to be discovered first.
   * @param repo - `owner/repo`.
   * @returns the first README found, or undefined.
   */
  private async fetchFirst(repo: string): Promise<{ markdown: string, sourceUrl: string } | undefined> {
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    for (const name of CANDIDATES) {
      const sourceUrl = `https://raw.githubusercontent.com/${repo}/HEAD/${name}`
      try {
        const response = await fetch(sourceUrl, { headers: { accept: 'text/plain' }, signal })
        if (!response.ok) continue
        const declared = Number(response.headers.get('content-length') ?? '0')
        // A repository can also serve a body longer than it declared, so the
        // real length is checked too. Truncation is marked rather than silent:
        // a README that stops mid-sentence with no explanation reads as a bug
        // in the marketplace.
        const text = declared > MAX_BYTES ? '' : await response.text()
        if (declared > MAX_BYTES || text.length > MAX_BYTES) {
          return { markdown: `${text.slice(0, MAX_BYTES)}\n\n---\n\n*${TRUNCATED_NOTE}*`, sourceUrl }
        }
        return { markdown: text, sourceUrl }
      } catch (error: unknown) {
        // A timeout aborts every remaining candidate too; stop rather than
        // burn the rest of the list on a signal that is already dead.
        if (signal.aborted) {
          this.warn(`plugin-hub: README fetch for ${repo} timed out`)
          return undefined
        }
        this.warn(`plugin-hub: README fetch for ${repo}/${name} failed: ${String(error)}`)
      }
    }
    return undefined
  }

  /**
   * Store a README, evicting the oldest entry when full.
   * @param repo - the cache key.
   * @param row - the fetched content.
   */
  private remember(repo: string, row: { markdown: string, sourceUrl: string }): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) this.cache.delete(oldest.value)
    }
    this.cache.set(repo, { ...row, at: Date.now() })
  }
}
