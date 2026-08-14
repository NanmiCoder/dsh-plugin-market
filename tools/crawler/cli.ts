#!/usr/bin/env node
/**
 * Crawler entry point.
 *
 *   node tools/crawler/cli.ts [options]
 *
 *   --dry-run        write to .tmp/ instead of data/, and print a diff summary
 *   --no-llm         skip labelling entirely, reusing cached labels
 *   --limit N        stop after N candidates (development)
 *   --topic T        sweep only this topic (repeatable)
 *   --force          bypass the labelling budget cap
 *   --budget N       GraphQL point ceiling (default 900)
 *
 * Requires GITHUB_TOKEN; DEEPSEEK_API_KEY unless --no-llm.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, extractSignals, monorepoDirectories, parseManifest } from './classify.ts'
import { DATA_DIR, README_CANDIDATES, SCHEMA_VERSION, TOPICS } from './config.ts'
import { fetchNpmFacts, fetchReadme, githubRepoFromUrl, mapLimit, searchNpm } from './enrich.ts'
import { drainSlice, fetchSubPackages, GitHubClient, planSlices } from './github.ts'
import { BudgetExceeded, candidateId, labelAll } from './label.ts'
import { score } from './score.ts'
import type { Candidate, CachedLabel, RawRepo } from './types.ts'
import type { Catalog, CatalogEntry } from '../../src/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Parsed command line. */
interface Options {
  readonly dryRun: boolean
  readonly noLlm: boolean
  readonly limit?: number
  readonly topics: readonly string[]
  readonly force: boolean
  readonly budget: number
}

/**
 * Parse argv.
 * @param argv - process arguments after the script name.
 * @returns the options.
 */
function parseArgs(argv: readonly string[]): Options {
  const topics: string[] = []
  let limit: number | undefined
  let budget = 900
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--limit') { limit = Number(argv[index + 1]); index += 1 }
    else if (arg === '--topic') { const value = argv[index + 1]; if (value !== undefined) topics.push(value); index += 1 }
    else if (arg === '--budget') { budget = Number(argv[index + 1]); index += 1 }
  }
  return {
    dryRun: argv.includes('--dry-run'),
    noLlm: argv.includes('--no-llm'),
    limit,
    topics: topics.length > 0 ? topics : TOPICS,
    force: argv.includes('--force'),
    budget,
  }
}

const log = (line: string): void => { console.log(line) }

/**
 * Load `.env` from the repository root if one exists.
 *
 * The crawler runs from a local scheduled job, so the key lives in a gitignored
 * file rather than a CI secret. Missing file is not an error — the environment
 * may already carry the variables.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(join(ROOT, '.env'))
  } catch {
    // No .env, or it is unreadable: fall through to the ambient environment.
  }
}

/**
 * Resolve the LLM API key.
 *
 * `ANTHROPIC_API_KEY` is what the Anthropic SDK itself looks for, so it is the
 * primary name; `DEEPSEEK_API_KEY` is accepted because the key that actually
 * works here is a DeepSeek one served over the Anthropic-compatible endpoint.
 * @returns the key, or undefined when neither is set.
 */
function resolveApiKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.DEEPSEEK_API_KEY
  return key === undefined || key === '' ? undefined : key
}

/** Run the pipeline. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  loadDotEnv()
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    console.error('GITHUB_TOKEN is required (try: GITHUB_TOKEN=$(gh auth token))')
    process.exit(1)
  }
  const client = new GitHubClient(token, options.budget, log)

  // ---- Discovery -----------------------------------------------------------
  const repos = new Map<string, RawRepo>()
  for (const topic of options.topics) {
    const slices = await planSlices(`topic:${topic}`, client, log)
    log(`discover: topic:${topic} → ${slices.length} slices`)
    for (const slice of slices) {
      const drained = await drainSlice(slice, client, log)
      for (const repo of drained) repos.set(repo.nameWithOwner.toLowerCase(), repo)
      log(`discover: ${slice} → ${drained.length} (total ${repos.size}, ${client.pointsSpent} points)`)
      if (options.limit !== undefined && repos.size >= options.limit) break
    }
    if (options.limit !== undefined && repos.size >= options.limit) break
  }
  let discovered = [...repos.values()]
  if (options.limit !== undefined) discovered = discovered.slice(0, options.limit)
  log(`discover: ${discovered.length} repositories, ${client.pointsSpent} GraphQL points`)

  // ---- Candidate expansion (monorepo second pass) --------------------------
  const candidates: Candidate[] = []
  const monorepoTargets: { repo: string, directories: string[] }[] = []
  for (const repo of discovered) {
    const manifest = parseManifest(repo.pkg?.text)
    candidates.push({ repo, manifest, patchText: repo.patchYml?.text })
    const directories = monorepoDirectories(repo, manifest)
    if (directories.length > 0) monorepoTargets.push({ repo: repo.nameWithOwner, directories })
  }
  if (monorepoTargets.length > 0) {
    log(`expand: probing ${monorepoTargets.length} possible monorepos`)
    const found = await fetchSubPackages(monorepoTargets, client)
    for (const [key, value] of found) {
      const separator = key.lastIndexOf(':')
      const repoName = key.slice(0, separator)
      const subdir = key.slice(separator + 1)
      const repo = repos.get(repoName.toLowerCase())
      const manifest = parseManifest(value.pkg)
      if (repo === undefined || manifest === undefined) continue
      candidates.push({ repo, subdir, manifest, patchText: value.patch })
    }
    log(`expand: ${candidates.length} candidates after expansion`)
  }

  // ---- npm channel ---------------------------------------------------------
  const npmHits = await searchNpm()
  log(`npm: ${npmHits.length} packages from keyword search`)
  const npmByRepo = new Map(npmHits.map(hit => [githubRepoFromUrl(hit.repositoryUrl) ?? '', hit]))
  const npmFacts = await mapLimit(candidates, async (candidate) => {
    const name = candidate.manifest?.name
    if (name === undefined || candidate.manifest?.private === true) return undefined
    return await fetchNpmFacts(name)
  })
  npmFacts.forEach((facts, index) => {
    const candidate = candidates[index]
    if (candidate === undefined || facts === undefined) return
    const hit = npmByRepo.get(candidate.repo.nameWithOwner)
    candidate.npm = { ...facts, weeklyDownloads: hit?.weeklyDownloads }
  })

  // ---- READMEs -------------------------------------------------------------
  const readmes = await mapLimit(candidates, async (candidate) => {
    // Root-level candidates: the discovery query already told us the exact
    // filename, so skip the six-way guess entirely. A repository whose root
    // tree holds no README at all needs no request.
    if (candidate.subdir === undefined) {
      const names = new Set((candidate.repo.rootTree?.entries ?? [])
        .filter(entry => entry.type === 'blob')
        .map(entry => entry.name))
      const known = README_CANDIDATES.find(name => names.has(name))
      if (known === undefined) return undefined
      return await fetchReadme(candidate.repo.nameWithOwner, undefined, known)
    }
    return await fetchReadme(candidate.repo.nameWithOwner, candidate.subdir)
  })
  readmes.forEach((readme, index) => {
    const candidate = candidates[index]
    if (candidate !== undefined && readme !== undefined) candidate.readme = readme
  })
  log(`enrich: ${readmes.filter(Boolean).length} READMEs fetched`)

  // ---- Classification ------------------------------------------------------
  const classified = candidates
    .map(candidate => ({ candidate, verdict: classify(candidate, extractSignals(candidate)) }))
    .filter((row): row is { candidate: Candidate, verdict: NonNullable<typeof row.verdict> } => row.verdict !== undefined)
  log(`classify: ${classified.length} kept of ${candidates.length}`)
  for (const tier of ['verified-npm', 'verified-git', 'likely-plugin', 'related'] as const) {
    log(`  ${tier}: ${classified.filter(row => row.verdict.tier === tier).length}`)
  }

  // ---- Labelling -----------------------------------------------------------
  const previous = readPreviousLabels()
  let labels = new Map<string, CachedLabel>()
  if (options.noLlm) {
    for (const { candidate } of classified) {
      const cached = previous.get(candidateId(candidate))
      if (cached !== undefined) labels.set(candidateId(candidate), cached)
    }
    log(`label: skipped (--no-llm), ${labels.size} reused from cache`)
  } else {
    const apiKey = resolveApiKey()
    if (apiKey === undefined) {
      console.error('ANTHROPIC_API_KEY (or DEEPSEEK_API_KEY) is required — put it in .env, or pass --no-llm')
      process.exit(1)
    }
    try {
      const result = await labelAll(classified.map(row => row.candidate), {
        apiKey, previous, force: options.force, log,
      })
      labels = result.labels
      log(
        `label: ${result.called} called, ${result.cached} cached, ${result.failed} degraded`
        + ` (${result.inputTokens} in / ${result.outputTokens} out tokens)`,
      )
    } catch (error: unknown) {
      if (error instanceof BudgetExceeded) {
        console.error(`\n${error.message}`)
        process.exit(2)
      }
      throw error
    }
  }

  // ---- Emit ----------------------------------------------------------------
  const siblingCount = new Map<string, number>()
  const entries: CatalogEntry[] = classified.map(({ candidate, verdict }) => {
    const repo = candidate.repo
    const id = candidateId(candidate)
    const label = labels.get(id)
    const rank = siblingCount.get(repo.nameWithOwner) ?? 0
    siblingCount.set(repo.nameWithOwner, rank + 1)
    const partial = {
      id,
      repo: repo.nameWithOwner,
      owner: repo.nameWithOwner.split('/')[0] ?? '',
      url: `https://github.com/${repo.nameWithOwner}`,
      tier: verdict.tier,
      packageName: candidate.manifest?.name,
      installMethod: verdict.installMethod,
      installSpec: verdict.installSpec,
      runsBuildScript: verdict.runsBuildScript,
      manualSteps: verdict.manualSteps,
      description: repo.description ?? '',
      summary: label?.summaryZh,
      summaryEn: label?.summaryEn,
      category: label?.category,
      tags: label?.tags ?? [],
      stars: repo.stargazerCount,
      forks: repo.forkCount,
      openIssues: repo.openIssues.totalCount,
      closedIssues: repo.closedIssues.totalCount,
      openPullRequests: repo.openPRs.totalCount,
      commits: repo.defaultBranchRef?.target?.history?.totalCount ?? 0,
      pushedAt: repo.pushedAt,
      createdAt: repo.createdAt,
      license: repo.licenseInfo?.spdxId ?? undefined,
      language: repo.primaryLanguage?.name ?? undefined,
      archived: repo.isArchived,
      isFork: repo.isFork,
      latestReleaseTag: repo.releases.nodes[0]?.tagName,
      latestReleaseAt: repo.releases.nodes[0]?.publishedAt,
      npmVersion: candidate.npm?.version,
      hasClient: verdict.capabilities.hasClient,
      hasSkills: verdict.capabilities.hasSkills,
      needsApiKey: verdict.capabilities.needsApiKey || label?.needsApiKey === true,
      labelStale: label?.stale === true ? true : undefined,
    }
    const ranked = score({
      ...partial,
      readmeBytes: candidate.readme?.text.length ?? 0,
      weeklyDownloads: candidate.npm?.weeklyDownloads,
      isSpam: label?.isSpam,
      confidence: label?.confidence,
      siblingRank: rank,
    })
    return { ...partial, score: ranked.total }
  })

  entries.sort((a, b) => b.score - a.score)
  writeOutputs(entries, labels, options.dryRun)
}

/**
 * Read labels from the previously published catalog.
 *
 * The catalog is its own cache: a separate cache file would drift from it, and
 * a CI cache would be evicted exactly when it matters.
 * @returns cached labels keyed by entry id.
 */
function readPreviousLabels(): Map<string, CachedLabel> {
  const labels = new Map<string, CachedLabel>()
  try {
    const raw = readFileSync(join(ROOT, DATA_DIR, 'labels.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, CachedLabel>
    for (const [id, label] of Object.entries(parsed)) labels.set(id, label)
  } catch {
    // No previous run: everything is new.
  }
  return labels
}

/**
 * Write the catalog, index, metadata, and label cache.
 * @param entries - the ranked entries.
 * @param labels - the label cache to persist.
 * @param dryRun - write to .tmp/ instead of data/.
 */
function writeOutputs(
  entries: readonly CatalogEntry[], labels: Map<string, CachedLabel>, dryRun: boolean,
): void {
  const outputDir = join(ROOT, dryRun ? '.tmp/data/v1' : DATA_DIR)
  mkdirSync(outputDir, { recursive: true })

  // contentHash deliberately excludes generatedAt: it is the "did anything
  // actually change" signal CI commits on.
  const contentHash = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16)
  const catalog: Catalog = {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      count: entries.length,
      contentHash,
    },
    entries,
  }

  let previousHash = ''
  try {
    const existing = JSON.parse(readFileSync(join(outputDir, 'meta.json'), 'utf8')) as { contentHash?: string }
    previousHash = existing.contentHash ?? ''
  } catch {
    // First run.
  }
  if (previousHash === contentHash) {
    log(`emit: contentHash unchanged (${contentHash}) — nothing written`)
    console.log(`::set-output-changed::false`)
    return
  }

  // Pretty-printed so git stores line-level deltas rather than one huge blob
  // per run, and so a reviewer can read what the labelling changed.
  writeFileSync(join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  const index = { meta: catalog.meta, entries: entries.map(compact) }
  writeFileSync(join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  writeFileSync(join(outputDir, 'meta.json'), `${JSON.stringify(catalog.meta, null, 2)}\n`)
  writeFileSync(join(outputDir, 'labels.json'), `${JSON.stringify(Object.fromEntries(labels), null, 2)}\n`)
  log(`emit: ${entries.length} entries → ${outputDir} (contentHash ${contentHash})`)
  console.log(`::set-output-changed::true`)
}

/**
 * Reduce an entry to the fields the marketplace UI actually renders.
 *
 * This is the document the plugin fetches at runtime, so it must be complete
 * enough to render a card without a second request: everything the UI reads is
 * kept, and only the fields that exist purely for auditing and scoring
 * provenance (issue and commit counts, fork flags, release timestamps) are
 * dropped. Roughly a quarter the size of the full catalog.
 * @param entry - the full entry.
 * @returns the compact form.
 */
function compact(entry: CatalogEntry): Partial<CatalogEntry> {
  return {
    id: entry.id,
    repo: entry.repo,
    owner: entry.owner,
    // `url` is omitted: it is always https://github.com/<repo>, and at ~1700
    // entries that redundancy is 7% of the document. The UI rebuilds it.
    description: entry.description,
    // `manualSteps` is omitted for the same reason: they are a fixed
    // clone-and-build recipe derived from repo and subdir, and the manual
    // dialog already generates exactly that when the field is absent.
    tier: entry.tier,
    packageName: entry.packageName,
    installMethod: entry.installMethod,
    installSpec: entry.installSpec,
    runsBuildScript: entry.runsBuildScript,
    summary: entry.summary,
    summaryEn: entry.summaryEn,
    category: entry.category,
    tags: entry.tags,
    stars: entry.stars,
    pushedAt: entry.pushedAt,
    license: entry.license,
    hasClient: entry.hasClient,
    hasSkills: entry.hasSkills,
    needsApiKey: entry.needsApiKey,
    score: entry.score,
  }
}

await main()
