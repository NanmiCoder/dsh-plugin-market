/**
 * Enrichment from sources outside the GraphQL API.
 *
 * READMEs come over raw HTTP with a Range header rather than through the
 * search query: including README text there makes the 50-repository page 502,
 * and raw requests cost no API quota at all.
 *
 * npm is queried because its manifest is the authoritative statement of what
 * an install will actually place on disk — the registry preserves the `dsh`
 * section verbatim, so it answers "is this installable" better than the
 * repository's HEAD does.
 */

import { createHash } from 'node:crypto'
import { NPM_KEYWORDS, README_BYTES, README_CANDIDATES } from './config.ts'
import type { NpmFacts, PackageManifest } from './types.ts'

/** Concurrency for the plain-HTTP enrichment passes. */
const CONCURRENCY = 12

/**
 * Fetch the head of a candidate's README.
 * @param repo - `owner/repo`.
 * @param subdir - directory within the repository, for monorepo children.
 * @returns the README head and its hash, or undefined when none was found.
 */
export async function fetchReadme(
  repo: string, subdir?: string,
): Promise<{ text: string, sha: string } | undefined> {
  const prefix = subdir === undefined ? '' : `${subdir}/`
  for (const file of README_CANDIDATES) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${prefix}${file}`
    try {
      const response = await fetch(url, {
        headers: { range: `bytes=0-${README_BYTES - 1}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status !== 200 && response.status !== 206) continue
      const text = await response.text()
      if (text.trim() === '') continue
      return { text, sha: createHash('sha256').update(text).digest('hex').slice(0, 16) }
    } catch {
      // Network hiccup on one filename: try the next candidate.
    }
  }
  return undefined
}

/**
 * Look up one package on the npm registry.
 *
 * The `/latest` document carries the published manifest, including the `dsh`
 * section, so `hasDshBundle` reflects what pnpm would install.
 * @param name - the package name.
 * @returns the facts, or undefined when unpublished.
 */
export async function fetchNpmFacts(name: string): Promise<NpmFacts | undefined> {
  const encoded = name.replace('/', '%2f')
  try {
    const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return undefined
    const manifest = await response.json() as PackageManifest & { repository?: { url?: string } }
    const repositoryUrl = typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository?.url
    return {
      name,
      version: manifest.version ?? '',
      hasDshBundle: manifest.dsh?.bundle?.patch !== undefined,
      hasClient: manifest.dsh?.client !== undefined || manifest.dshClient !== undefined,
      repositoryUrl,
    }
  } catch {
    return undefined
  }
}

/** One package as reported by npm's search endpoint. */
export interface NpmSearchHit {
  readonly name: string
  readonly description?: string
  readonly repositoryUrl?: string
  readonly weeklyDownloads?: number
}

/**
 * Sweep npm keywords as a second discovery channel.
 *
 * This catches plugins published to npm whose repository never carried a
 * GitHub topic — invisible to the topic sweep entirely.
 * @returns the hits, deduplicated by package name.
 */
export async function searchNpm(): Promise<NpmSearchHit[]> {
  const hits = new Map<string, NpmSearchHit>()
  for (const keyword of NPM_KEYWORDS) {
    try {
      const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${encodeURIComponent(keyword)}&size=250`
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) continue
      const body = await response.json() as {
        objects?: {
          package?: { name?: string, description?: string, links?: { repository?: string } }
          downloads?: { weekly?: number }
        }[]
      }
      for (const object of body.objects ?? []) {
        const name = object.package?.name
        if (name === undefined || hits.has(name)) continue
        hits.set(name, {
          name,
          description: object.package?.description,
          repositoryUrl: object.package?.links?.repository,
          // Inlined by the search endpoint, so no second downloads request is
          // needed — and the downloads API 404s for freshly published packages.
          weeklyDownloads: object.downloads?.weekly,
        })
      }
    } catch {
      // One keyword failing must not void the channel.
    }
  }
  return [...hits.values()]
}

/**
 * Extract `owner/repo` from an npm repository URL.
 * @param url - the repository URL in any of npm's shapes.
 * @returns `owner/repo`, or undefined when it is not a GitHub URL.
 */
export function githubRepoFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const match = /github\.com[/:]([^/]+)\/([^/#.]+)/.exec(url)
  if (match === null) return undefined
  return `${match[1]}/${match[2]}`
}

/**
 * Run an async mapper over a list with bounded concurrency.
 * @param items - the inputs.
 * @param mapper - the async operation.
 * @param limit - maximum simultaneous operations.
 * @returns the results, in input order.
 */
export async function mapLimit<T, R>(
  items: readonly T[], mapper: (item: T, index: number) => Promise<R>, limit = CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}
