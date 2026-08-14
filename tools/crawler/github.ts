/**
 * GitHub discovery: a rate-aware GraphQL client, star-bucket slicing, and the
 * monorepo second pass.
 *
 * Two measured constraints shape this module:
 *
 *  1. Adding README text to the search query makes it 502 at 50 repositories
 *     per page. READMEs are therefore fetched over raw HTTP (see enrich.ts),
 *     not here.
 *  2. Past the 1000-result search ceiling, GitHub returns an empty node list
 *     with `hasNextPage: false` instead of an error — a silent truncation. The
 *     drain below asserts it collected what the query declared.
 */

import { PAGE_SIZE, SEARCH_CEILING, SPLIT_THRESHOLD, STAR_BUCKETS } from './config.ts'
import type { RawRepo } from './types.ts'

/** One page of search results. */
interface SearchPage {
  readonly repositoryCount: number
  readonly hasNextPage: boolean
  readonly endCursor: string | null
  readonly nodes: RawRepo[]
}

/** Raised when a slice returned fewer repositories than it declared. */
export class SliceTruncated extends Error {}

/** The repository fields every stage downstream depends on. */
const REPO_FIELDS = `
  databaseId nameWithOwner description homepageUrl
  isArchived isFork isMirror isEmpty
  createdAt pushedAt
  stargazerCount forkCount
  licenseInfo { spdxId }
  primaryLanguage { name }
  repositoryTopics(first: 25) { nodes { topic { name } } }
  openIssues: issues(states: OPEN) { totalCount }
  closedIssues: issues(states: CLOSED) { totalCount }
  openPRs: pullRequests(states: OPEN) { totalCount }
  releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
    totalCount nodes { tagName publishedAt }
  }
  defaultBranchRef { target { ... on Commit { committedDate history(first: 1) { totalCount } } } }
  pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
  patchYml: object(expression: "HEAD:cordis.patch.yml") { ... on Blob { text } }
  rootTree: object(expression: "HEAD:") { ... on Tree { entries { name type } } }
`

/**
 * Search + enrich in one request. README is deliberately absent; see the
 * module note.
 *
 * The page size is templated rather than fixed because the full field set at
 * 50 repositories per page reliably 502s: no single field is responsible, the
 * combined response simply exceeds what the endpoint will assemble. Since the
 * rate-limit cost is 1 point per request regardless of page size, halving the
 * page is nearly free.
 * @param size - repositories per page.
 * @returns the query document.
 */
function discoverQuery(size: number): string {
  return `
query Discover($q: String!, $after: String) {
  rateLimit { cost remaining resetAt }
  search(query: $q, type: REPOSITORY, first: ${size}, after: $after) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on Repository { ${REPO_FIELDS} } }
  }
}`
}

/** Count-only probe used while planning slices. */
const COUNT_QUERY = `
query Count($q: String!) {
  rateLimit { cost remaining }
  search(query: $q, type: REPOSITORY, first: 1) { repositoryCount }
}`

/** A rate-aware GraphQL client with a spend ceiling. */
export class GitHubClient {
  private spent = 0
  // Explicit fields rather than constructor parameter properties: this file
  // runs through Node's strip-only TypeScript mode, which rejects those.
  private readonly token: string
  private readonly budget: number
  private readonly log: (line: string) => void

  constructor(token: string, budget: number, log: (line: string) => void) {
    this.token = token
    this.budget = budget
    this.log = log
  }

  /** GraphQL points consumed so far. */
  get pointsSpent(): number {
    return this.spent
  }

  /**
   * Execute one GraphQL request, retrying transient failures.
   * @param query - the GraphQL document.
   * @param variables - the query variables.
   * @returns the `data` payload.
   * @throws when the budget is exhausted or every retry failed.
   */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (this.spent >= this.budget) {
      throw new Error(`github: GraphQL budget of ${this.budget} points exhausted`)
    }
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            authorization: `bearer ${this.token}`,
            'content-type': 'application/json',
            'user-agent': 'dsh-plugin-hub-crawler',
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(60_000),
        })
        // 502 is routine here when a page's payload is large; retry it.
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}`)
        }
        const body = await response.json() as {
          data?: T & { rateLimit?: { cost: number, remaining: number } }
          errors?: { type?: string, message: string }[]
        }
        if (body.errors !== undefined && body.errors.length > 0) {
          const rateLimited = body.errors.some(error => error.type === 'RATE_LIMITED')
          if (rateLimited) {
            this.log('github: rate limited, waiting 60s')
            await sleep(60_000)
            continue
          }
          throw new Error(body.errors.map(error => error.message).join('; '))
        }
        if (body.data === undefined) throw new Error('github: empty response data')
        this.spent += body.data.rateLimit?.cost ?? 1
        // Constant spacing keeps well clear of the secondary rate limit.
        await sleep(250)
        return body.data
      } catch (error: unknown) {
        lastError = error
        const backoff = 1000 * 2 ** attempt
        this.log(`github: request failed (${String(error)}), retrying in ${backoff}ms`)
        await sleep(backoff)
      }
    }
    throw new Error(`github: request failed after retries: ${String(lastError)}`)
  }

  /**
   * Count repositories matching a query.
   * @param q - the search query.
   * @returns the declared repository count.
   */
  async count(q: string): Promise<number> {
    const data = await this.graphql<{ search: { repositoryCount: number } }>(COUNT_QUERY, { q })
    return data.search.repositoryCount
  }

  /**
   * Fetch one page of a slice.
   * @param q - the search query.
   * @param after - the pagination cursor.
   * @param size - repositories to request.
   * @returns the page.
   */
  async page(q: string, after: string | null, size: number): Promise<SearchPage> {
    const data = await this.graphql<{
      search: {
        repositoryCount: number
        pageInfo: { hasNextPage: boolean, endCursor: string | null }
        nodes: (RawRepo | null)[]
      }
    }>(discoverQuery(size), { q, after })
    return {
      repositoryCount: data.search.repositoryCount,
      hasNextPage: data.search.pageInfo.hasNextPage,
      endCursor: data.search.pageInfo.endCursor,
      nodes: data.search.nodes.filter((node): node is RawRepo => node !== null),
    }
  }
}

/**
 * Plan slices for one base query, splitting until each is safely small.
 *
 * Star buckets come first; a bucket still over the threshold is halved by
 * creation date. Counts are approximate and drift by tens between calls, hence
 * a threshold well below the real ceiling.
 * @param base - the base query (e.g. `topic:dsh-plugin`).
 * @param client - the GraphQL client.
 * @param log - progress sink.
 * @returns the slice queries to drain.
 */
export async function planSlices(
  base: string, client: GitHubClient, log: (line: string) => void,
): Promise<string[]> {
  const planned: string[] = []
  const now = new Date()
  for (const bucket of STAR_BUCKETS) {
    await refine(`${base} ${bucket}`, 0, EPOCH, now)
  }
  return planned

  /**
   * Split one query until it is small enough to drain completely.
   *
   * The date window is threaded through the recursion rather than derived
   * from the depth: each half must narrow within its OWN bounds, and a
   * depth-derived window would keep halving the same recent span, so the
   * older half would never actually narrow.
   * @param q - the query so far.
   * @param depth - recursion depth, bounding the work.
   * @param lo - inclusive lower bound of this branch's creation window.
   * @param hi - exclusive upper bound of this branch's creation window.
   */
  async function refine(q: string, depth: number, lo: Date, hi: Date): Promise<void> {
    const count = await client.count(q)
    if (count === 0) return
    if (count <= SPLIT_THRESHOLD || depth >= 6) {
      if (count > SPLIT_THRESHOLD) {
        log(`github: slice "${q}" declares ${count} and cannot be split further; it will be truncated`)
      }
      planned.push(q)
      return
    }
    const midMs = (lo.getTime() + hi.getTime()) / 2
    const mid = new Date(midMs)
    const midDay = mid.toISOString().slice(0, 10)
    // Once the window is a single day there is nothing left to halve.
    if (hi.getTime() - lo.getTime() < 2 * 86_400_000) {
      log(`github: slice "${q}" declares ${count} within a one-day window; it will be truncated`)
      planned.push(q)
      return
    }
    log(`github: splitting "${q}" (${count}) at created:${midDay}`)
    await refine(`${q} created:<${midDay}`, depth + 1, lo, mid)
    await refine(`${q} created:>=${midDay}`, depth + 1, mid, hi)
  }
}

/** Earliest plausible creation date for this ecosystem, as the split floor. */
const EPOCH = new Date('2025-01-01T00:00:00Z')

/**
 * Drain every page of one slice.
 * @param q - the slice query.
 * @param client - the GraphQL client.
 * @returns the repositories collected.
 * @throws SliceTruncated when the collected count falls short of the declared one.
 */
export async function drainSlice(
  q: string, client: GitHubClient, log: (line: string) => void = () => {},
): Promise<RawRepo[]> {
  const collected: RawRepo[] = []
  let after: string | null = null
  let declared = -1
  let pages = 0
  let size = PAGE_SIZE
  do {
    let page: SearchPage
    try {
      page = await client.page(q, after, size)
    } catch (error: unknown) {
      // The endpoint refuses to assemble an oversized response. Halve the page
      // and retry the same cursor; each request costs 1 point either way.
      if (size <= 10) throw error
      size = Math.max(10, Math.floor(size / 2))
      log(`github: page failed, retrying "${q}" at first:${size}`)
      continue
    }
    if (declared < 0) declared = page.repositoryCount
    collected.push(...page.nodes)
    after = page.hasNextPage ? page.endCursor : null
    pages += 1
  } while (after !== null && pages < SEARCH_CEILING / 10)

  // The silent-truncation guard. Counts drift, so allow a margin; a real
  // truncation loses far more than 10%.
  const expected = Math.min(declared, SEARCH_CEILING)
  if (collected.length < expected * 0.9) {
    throw new SliceTruncated(
      `slice "${q}" yielded ${collected.length} of ${declared} declared — `
      + 'GitHub truncated it silently. Lower SPLIT_THRESHOLD or add a slicing dimension.',
    )
  }
  return collected
}

/**
 * Fetch candidate sub-package manifests for monorepos, 20 repositories per request.
 *
 * Plugin packages do not live under a predictable directory: observed layouts
 * include `packages/*`, `plugin/`, `bundle/`, and a directory named after the
 * repository. Callers pass the directories they saw in the root tree.
 * @param targets - repositories and the directories to probe within them.
 * @param client - the GraphQL client.
 * @returns manifest text keyed by `owner/repo:directory`.
 */
export async function fetchSubPackages(
  targets: { repo: string, directories: string[] }[], client: GitHubClient,
): Promise<Map<string, { pkg?: string, patch?: string }>> {
  const results = new Map<string, { pkg?: string, patch?: string }>()
  for (let index = 0; index < targets.length; index += 20) {
    const batch = targets.slice(index, index + 20)
    const parts: string[] = []
    batch.forEach((target, repoIndex) => {
      const [owner, name] = target.repo.split('/')
      if (owner === undefined || name === undefined) return
      const fields = target.directories.slice(0, 8).map((directory, dirIndex) => `
        d${dirIndex}p: object(expression: "HEAD:${directory}/package.json") { ... on Blob { text } }
        d${dirIndex}y: object(expression: "HEAD:${directory}/cordis.patch.yml") { ... on Blob { text } }`).join('')
      parts.push(`r${repoIndex}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} }`)
    })
    if (parts.length === 0) continue
    const query = `query SubPackages { rateLimit { cost remaining } ${parts.join('\n')} }`
    const data = await client.graphql<Record<string, Record<string, { text?: string } | null> | null>>(query, {})
    batch.forEach((target, repoIndex) => {
      const repoData = data[`r${repoIndex}`]
      if (repoData === null || repoData === undefined) return
      target.directories.slice(0, 8).forEach((directory, dirIndex) => {
        const pkg = repoData[`d${dirIndex}p`]?.text
        const patch = repoData[`d${dirIndex}y`]?.text
        if (pkg === undefined && patch === undefined) return
        results.set(`${target.repo}:${directory}`, { pkg, patch })
      })
    })
  }
  return results
}

/**
 * Pause execution.
 * @param ms - milliseconds to wait.
 * @returns a promise resolving after the delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}
