#!/usr/bin/env node
/**
 * Offline smoke checks for dsh-plugin-hub.
 *
 * Covers the pure decision layers — classification rules, install-spec
 * derivation, scoring, catalog parsing and its forward guard, the install
 * safety gate, and the label validator — plus the shape of any published
 * catalog found on disk. Runs in a temporary directory, touches no running DSH
 * instance or profile, and needs no network.
 *
 * Requires `pnpm build` first (host sources are imported from lib/).
 * Usage: node scripts/verify.mjs
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0

/**
 * Assert one condition.
 * @param {string} label - what is being checked.
 * @param {boolean} condition - the result.
 * @param {string} [detail] - extra context on failure.
 */
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('1/6 catalog parsing and the forward guard')
const { parseCatalog } = await import('../lib/registry.js')
const { isCompatible, SUPPORTED_SCHEMA_VERSION, INSTALLABLE_TIERS } = await import('../lib/types.js')

const goodEntry = {
  id: 'owner/repo', repo: 'owner/repo', owner: 'owner', url: 'https://github.com/owner/repo',
  tier: 'verified-npm', installMethod: 'npm', installSpec: 'demo-plugin', packageName: 'demo-plugin',
  runsBuildScript: false, description: 'demo', tags: ['git'], stars: 3, forks: 0,
  openIssues: 0, closedIssues: 0, openPullRequests: 0, commits: 10,
  pushedAt: '2026-08-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z',
  archived: false, isFork: false, hasClient: true, hasSkills: false, needsApiKey: false, score: 80,
}
const goodMeta = { schemaVersion: 1, generatedAt: '2026-08-14T00:00:00Z', count: 1, contentHash: 'abc' }

check('parses a well-formed catalog', parseCatalog({ meta: goodMeta, entries: [goodEntry] })?.entries.length === 1)
check('rejects a non-object', parseCatalog(null) === undefined)
check('rejects a missing meta', parseCatalog({ entries: [] }) === undefined)
check('rejects a non-array entries', parseCatalog({ meta: goodMeta, entries: {} }) === undefined)
check(
  'drops one malformed row without voiding the feed',
  parseCatalog({ meta: goodMeta, entries: [goodEntry, { id: 'x' }] })?.entries.length === 1,
)
check(
  'rejects an unknown tier',
  parseCatalog({ meta: goodMeta, entries: [{ ...goodEntry, tier: 'invented' }] })?.entries.length === 0,
)
check(
  'defaults an unknown installMethod to manual',
  parseCatalog({ meta: goodMeta, entries: [{ ...goodEntry, installMethod: 'wat' }] })?.entries[0].installMethod === 'manual',
)
check('accepts the supported schema version', isCompatible(goodMeta))
check('refuses a newer schema version', !isCompatible({ ...goodMeta, schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 }))
check('accepts an older schema version', isCompatible({ ...goodMeta, schemaVersion: 0 }))

console.log('\n2/6 install safety gate')
const { isSafeSpec } = await import('../lib/installer.js')
check('accepts a bare package name', isSafeSpec('dsh-cc-tui'))
check('accepts a scoped package name', isSafeSpec('@scope/dsh-thing'))
check('accepts a versioned spec', isSafeSpec('dsh-thing@1.2.3'))
check('accepts a github spec', isSafeSpec('github:owner/repo'))
check('refuses a leading dash (would be read as a pnpm flag)', !isSafeSpec('--registry=http://evil'))
check('refuses an empty spec', !isSafeSpec(''))
check('refuses shell metacharacters', !isSafeSpec('pkg; rm -rf /'))
check('refuses a spec with spaces', !isSafeSpec('pkg --force'))
check('refuses an over-long spec', !isSafeSpec('a'.repeat(201)))
check('installable tiers are exactly the verified ones', INSTALLABLE_TIERS.join(',') === 'verified-npm,verified-git')

console.log('\n2b/6 the installer runs the normalized spec, not README prose')
{
  // The catalog carries `installSpec` — already normalized by the crawler to
  // the only two shapes dsh itself uses (an npm name or `github:owner/repo`).
  // Executing the README's command verbatim instead was the regression that
  // broke installs: hardcoded `--profile web`, shell metacharacters and
  // `<placeholder>` templates all live in README prose, not in the spec.
  const { Installer } = await import('../lib/installer.js')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-hub-hint-'))
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }))
  const installer = new Installer({ profileDir, allowInstall: true, loader: {}, warn: () => {} })
  const base = {
    id: 'a/b', repo: 'a/b', owner: 'a', url: 'https://github.com/a/b',
    tier: 'verified-npm', installMethod: 'npm', installSpec: '@a/b', packageName: '@a/b',
    runsBuildScript: false, description: '', tags: [], topics: [],
    stars: 0, forks: 0, openIssues: 0, closedIssues: 0, openPullRequests: 0, commits: 0,
    pushedAt: '', createdAt: '', archived: false, isFork: false,
    hasClient: false, hasSkills: false, needsApiKey: false, nativeTs: false, score: 0,
  }
  // An entry the crawler could not normalize has nothing safe to hand pnpm.
  const noSpec = await installer.install({ ...base, installMethod: 'manual', installSpec: undefined })
  check('an entry without a normalized spec is refused', !noSpec.ok)
  check('the refusal points at manual install', noSpec.message.includes('manually'))
  // A spec that is not a plain package name or github: spec never reaches pnpm,
  // no matter what the catalog file says.
  const unsafe = await installer.install({ ...base, installSpec: '@a/b; rm -rf ~' })
  check('a spec with shell metacharacters is refused before pnpm runs', !unsafe.ok && unsafe.message.includes('invalid install spec'))
  // The README's own wording is display-only: a hint command full of shell
  // syntax must not change what the installer validates.
  const hintIgnored = await installer.install({
    ...base, installSpec: '@a/b; rm -rf ~', installHint: { method: 'npm', command: 'dsh plugin --profile web add @a/b' },
  })
  check('the README command is never the executed input', !hintIgnored.ok && hintIgnored.message.includes('invalid install spec'))
}

console.log('\n2c/6 the .env key wins over a competing shell token')
{
  // The Anthropic SDK prefers ANTHROPIC_AUTH_TOKEN over ANTHROPIC_API_KEY, so
  // a shell exporting both — common with Kimi or another compatible provider —
  // silently sends our requests to the wrong endpoint and they 401. This is
  // the exact failure that produced a full run of empty labels.
  const { execFileSync } = await import('node:child_process')
  const env = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: 'sk-wrong-token-from-shell',
    ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
    ANTHROPIC_API_KEY: 'sk-real-key-from-env-file',
  }
  const probe = `
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    console.log(process.env.ANTHROPIC_API_KEY ?? 'missing');
  `
  const out = execFileSync(process.execPath, ['-e', probe], { env, encoding: 'utf8' }).trim()
  check('the env-file key survives after the competing token is stripped', out === 'sk-real-key-from-env-file')
}

console.log('\n2d/6 README command vs. verified spec comparison')
{
  // The confirmation dialog shows the README's command only when it disagrees
  // with what will run. `npm i @x` and `pnpm add @x` must NOT count as a
  // disagreement — the gap is only meaningful when the target itself differs.
  const { sameInstallTarget } = await import('../lib/client-utils.js')
  check('npm and pnpm naming the same package agree', sameInstallTarget('npm i @a/b', '@a/b'))
  check('pnpm add and npm i agree', sameInstallTarget('pnpm add @a/b', '@a/b'))
  check('a version suffix is not a disagreement', sameInstallTarget('npm i @a/b@1.2.3', '@a/b'))
  check('a different package is a disagreement', !sameInstallTarget('npm i @a/b', '@a/c'))
  check('a github URL matching the spec agrees', sameInstallTarget('dsh plugin add github:a/b', 'github:a/b'))
  check('a different repository is a disagreement', !sameInstallTarget('git clone https://github.com/a/c', 'github:a/b'))
  check('an unrecognized command never counts as agreeing', !sameInstallTarget('curl | bash', '@a/b'))
  check('no spec means no agreement', !sameInstallTarget('npm i @a/b', undefined))
  // The DSH CLI names the same package with extra words in between.
  check('dsh plugin add with a --profile flag agrees', sameInstallTarget('dsh plugin --profile web add @a/b', '@a/b'))
  check('dsh plugin add without a flag agrees', sameInstallTarget('dsh plugin add @a/b', '@a/b'))
  check('a dsh command for a different package disagrees', !sameInstallTarget('dsh plugin add @a/b', '@a/c'))
}

console.log('\n3/6 request-trust fence')
const { isTrustedRequest, isLoopbackHostname } = await import('../lib/request-trust.js')
check('loopback v4 recognised', isLoopbackHostname('127.0.0.1'))
check('loopback v6 recognised', isLoopbackHostname('[::1]'))
check('localhost recognised', isLoopbackHostname('localhost'))
check('LAN address is not loopback', !isLoopbackHostname('192.168.1.5'))
check('accepts a loopback host', isTrustedRequest({ headers: { host: '127.0.0.1:3080' } }, []))
check('refuses a missing host', !isTrustedRequest({ headers: {} }, []))
check('refuses a foreign host (DNS rebinding)', !isTrustedRequest({ headers: { host: 'evil.example' } }, []))
check('accepts a declared trusted host', isTrustedRequest({ headers: { host: '192.168.1.5:3080' } }, ['192.168.1.5']))
check(
  'refuses a cross-site marker',
  !isTrustedRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }, []),
)
check(
  'refuses a mismatched Origin',
  !isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' } }, []),
)
check(
  'accepts a matching Origin',
  isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }, []),
)
check(
  'refuses an opaque null Origin',
  !isTrustedRequest({ headers: { host: '127.0.0.1:3080', origin: 'null' } }, []),
)

console.log('\n4/6 classification rules')
const { isValidPatchFile, parseManifest, monorepoDirectories } = await import('../tools/crawler/classify.ts')
check('accepts a real patch list', isValidPatchFile('- insert:\n    - id: x\n      name: y\n'))
check('accepts a comment-led patch list', isValidPatchFile('# note\n- insert:\n    - id: x\n'))
check('refuses an empty file', !isValidPatchFile(''))
check('refuses a comments-only file', !isValidPatchFile('# nothing here\n'))
check('refuses an object-rooted file (DSH would reject it)', !isValidPatchFile('insert:\n  - id: x\n'))
check('refuses undefined', !isValidPatchFile(undefined))
check('parses a manifest', parseManifest('{"name":"x"}')?.name === 'x')
check('tolerates malformed json', parseManifest('{oops') === undefined)

// `nativeTs` decides whether a TS plugin needs a build at all — the difference
// between "git install works" and "git install leaves nothing loadable". The
// Node 26 strip-only loader is what makes the distinction real.
const { extractSignals } = await import('../tools/crawler/classify.ts')
const sig = (manifest) => extractSignals({
  manifest, patchText: undefined, npm: undefined,
  repo: { nameWithOwner: 'a/b', rootTree: { entries: [] } },
})
check('a .ts main marks nativeTs', sig({ main: 'src/index.ts' }).nativeTs === true)
check('a .tsx main marks nativeTs', sig({ main: 'src/main.tsx' }).nativeTs === true)
check('a .js main is not nativeTs', sig({ main: 'lib/index.js' }).nativeTs === false)
check('no main is not nativeTs', sig({}).nativeTs === false)
check('a prepare script disqualifies nativeTs', sig({ main: 'src/index.ts', scripts: { prepare: 'x' } }).nativeTs === false)

const treeRepo = entries => ({ rootTree: { entries: entries.map(name => ({ name, type: 'tree' })) } })
check(
  'skips expansion when the root already declares a bundle',
  monorepoDirectories(treeRepo(['packages']), { dsh: { bundle: { patch: './cordis.patch.yml' } } }).length === 0,
)
check(
  'probes conventional workspace roots',
  monorepoDirectories(treeRepo(['packages', 'docs']), { workspaces: ['packages/*'] }).includes('packages'),
)
check(
  'probes an unconventional directory when there is no root manifest',
  monorepoDirectories(treeRepo(['plugin']), undefined).includes('plugin'),
)
check(
  'never probes denylisted directories',
  !monorepoDirectories(treeRepo(['docs', 'node_modules', 'dist']), undefined).includes('node_modules'),
)

console.log('\n4a/6 monorepo root de-duplication')
{
  const { dropRedundantRoots } = await import('../tools/crawler/classify.ts')
  const row = (repo, subdir, tier, method, name) => ({
    candidate: { repo: { nameWithOwner: repo }, subdir, manifest: name === undefined ? undefined : { name } },
    verdict: { tier, installMethod: method },
  })
  // The observed shape: a bare repo root plus a sub-package, rendering as two
  // identical-looking rows. 75 repositories were duplicated this way.
  const withChild = dropRedundantRoots([
    row('a/archify', undefined, 'related', 'manual', undefined),
    row('a/archify', 'archify', 'related', 'manual', 'archify'),
  ])
  check('a bare root beside a sub-package is dropped', withChild.length === 1)
  check('the sub-package is the one kept', withChild[0].candidate.subdir === 'archify')

  // A root with no sibling is the only row there is; dropping it loses the repo.
  check(
    'a lone root is never dropped',
    dropRedundantRoots([row('b/solo', undefined, 'related', 'manual', undefined)]).length === 1,
  )
  // A root that is itself a plugin is a different thing from its children.
  check(
    'an installable root survives beside its children',
    dropRedundantRoots([
      row('c/mono', undefined, 'verified-npm', 'npm', 'mono'),
      row('c/mono', 'pkg', 'verified-npm', 'npm', 'mono-pkg'),
    ]).length === 2,
  )
  check(
    'a root with a DIFFERENT package name survives',
    dropRedundantRoots([
      row('d/mono', undefined, 'related', 'manual', 'mono-root'),
      row('d/mono', 'pkg', 'related', 'manual', 'mono-pkg'),
    ]).length === 2,
  )
  // Observed once in the published catalog: a workspace root and its own
  // sub-package declaring the identical name. One plugin, reached two ways.
  const sameName = dropRedundantRoots([
    row('g/dsh-work', undefined, 'related', 'manual', 'dsh-desktop'),
    row('g/dsh-work', 'desktop', 'related', 'manual', 'dsh-desktop'),
    row('g/dsh-work', 'renderer', 'related', 'manual', 'dsh-renderer'),
  ])
  check('a root sharing a child’s package name is dropped', sameName.length === 2)
  check('its distinctly-named siblings are untouched', sameName.every(r => r.candidate.subdir !== undefined))
  // Roots of OTHER repositories must not be affected by a sibling elsewhere.
  check(
    'de-duplication is scoped per repository',
    dropRedundantRoots([
      row('e/one', undefined, 'related', 'manual', undefined),
      row('f/two', undefined, 'related', 'manual', undefined),
      row('f/two', 'pkg', 'related', 'manual', 'two-pkg'),
    ]).length === 2,
  )
}

console.log('\n4b/6 slice planning')
const { planSlices } = await import('../tools/crawler/github.ts')
// A client that behaves the way GitHub does: the count falls as the window
// narrows. The previous stub keyed off how many `created:` qualifiers the
// query carried, which is exactly the broken behaviour it was meant to catch —
// it reported success for a planner whose splits never narrowed anything.
const REPOS_PER_DAY = 4
const splitting = {
  count: async (q) => {
    const m = /created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q)
    if (m === null) return 5000
    // Only the last 400 days carry repositories, so one half of every early
    // split is empty — the case where a depth-derived window silently loses
    // the other half.
    const start = Date.parse(`${m[1]}T00:00:00Z`)
    const end = Date.parse(`${m[2]}T00:00:00Z`)
    const populatedFrom = Date.now() - 400 * 86_400_000
    const overlap = Math.min(end, Date.now()) - Math.max(start, populatedFrom)
    return overlap <= 0 ? 0 : Math.round((overlap / 86_400_000) * REPOS_PER_DAY)
  },
}
const planned = await planSlices('topic:x', splitting, () => {})
const windows = planned.map(q => /created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q))
check('planner splits oversized slices', planned.length > 6)
check('every planned slice is a query string', planned.every(q => typeof q === 'string' && q.startsWith('topic:x')))

// The bug this guards: appending `created:<x` to a query that already carries
// a `created:` qualifier does not intersect them — GitHub honours one — so
// every "split" re-fetches the same first 1000 rows and the rest are lost.
// A slice must therefore carry EXACTLY ONE date qualifier.
check(
  'each slice carries exactly one date qualifier',
  planned.every(q => (q.match(/created:/g) ?? []).length === 1),
  `worst: ${planned.find(q => (q.match(/created:/g) ?? []).length !== 1) ?? '(none)'}`,
)
check('each slice expresses its window as a single range', windows.every(m => m !== null))
check('every window is non-empty (lo <= hi)', windows.every(m => m !== null && m[1] <= m[2]))

// The other bug this guards: deriving the split window from recursion depth
// instead of threading it through makes every split land in the same recent
// span, so the older half never narrows and its repositories are lost. The
// plan must therefore reach back over the whole populated span — empty
// windows outside it are correctly pruned rather than fetched.
const bounds = windows.filter(Boolean)
const lowest = bounds.map(m => m[1]).sort()[0]
const highest = bounds.map(m => m[2]).sort().at(-1)
const day = ms => new Date(ms).toISOString().slice(0, 10)
const populatedFrom = day(Date.now() - 400 * 86_400_000)
check(
  'the plan reaches back over the whole populated span',
  lowest <= populatedFrom && highest >= day(Date.now() - 86_400_000),
  `spanned ${lowest} .. ${highest}, needed ${populatedFrom} .. today`,
)
check(
  'empty windows are pruned rather than fetched',
  bounds.every(m => m[2] >= populatedFrom),
  `oldest window end: ${bounds.map(m => m[2]).sort()[0]}`,
)

// Within one star bucket, no two windows may overlap: an overlap means the
// same repositories are fetched twice and points are spent for nothing. Gaps
// are legitimate — a window the stub reports as empty is not planned at all.
const perBucket = new Map()
for (const q of planned) {
  const m = /^(.*?) created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(q)
  if (m === null) continue
  if (!perBucket.has(m[1])) perBucket.set(m[1], [])
  perBucket.get(m[1]).push([m[2], m[3]])
}
const overlapping = [...perBucket.values()].some((list) => {
  const sorted = [...list].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return sorted.some((w, i) => i > 0 && w[0] <= sorted[i - 1][1])
})
check('windows within a bucket never overlap', !overlapping)

// And the populated span must be covered end to end, or repositories fall
// between two slices and are fetched by neither.
const covered = [...perBucket.values()].every((list) => {
  const sorted = [...list].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return sorted.every((w, i) => {
    if (i === 0) return true
    const previousEnd = Date.parse(`${sorted[i - 1][1]}T00:00:00Z`)
    return Date.parse(`${w[0]}T00:00:00Z`) === previousEnd + 86_400_000
  })
})
check('the planned windows leave no hole inside the populated span', covered)

const neverStops = { count: async () => 5000 }
const bounded = await planSlices('topic:x', neverStops, () => {})
check('planner terminates when a window cannot be split', bounded.length > 0 && bounded.length < 500)
check(
  'even the pathological plan keeps one date qualifier per slice',
  bounded.every(q => (q.match(/created:/g) ?? []).length === 1),
)

console.log('\n4c/6 GraphQL partial responses')
const { GitHubClient, PermanentQueryError } = await import('../tools/crawler/github.ts')
const realFetch = globalThis.fetch
/**
 * Run one client call against a stubbed endpoint.
 * @param {object} body - the JSON body the endpoint should return.
 * @returns {Promise<{data?: unknown, error?: Error}>} the outcome.
 */
async function withStubbedFetch(body) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
  try {
    const client = new GitHubClient('t', 50, () => {})
    return { data: await client.graphql('query{x}', {}) }
  } catch (error) {
    return { error }
  } finally {
    globalThis.fetch = realFetch
  }
}

// A batched query naming 20 repositories returns the ones that resolved plus a
// NOT_FOUND for any deleted between passes. Discarding that response loses 19
// good results and, after retries, killed an entire 168-point run.
const partial = await withStubbedFetch({
  data: { rateLimit: { cost: 1 }, r0: { nameWithOwner: 'a/b' }, r1: null },
  errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository', path: ['r1'] }],
})
check('keeps partial data when one alias is NOT_FOUND', partial.data?.r0?.nameWithOwner === 'a/b')
check('reports the dead alias as null, not an error', partial.data?.r1 === null)

const noData = await withStubbedFetch({
  errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }],
})
check('throws when there is no data at all', noData.error !== undefined)
check('a NOT_FOUND with no data is permanent, not retried',
  noData.error instanceof PermanentQueryError, String(noData.error))

console.log('\n5/6 label validation and scoring')
const { validateLabel, clipReadme } = await import('../tools/crawler/label.ts')
const validLabel = {
  category: 'coding', tags: ['git', 'code-review'], summaryZh: '一个测试插件',
  summaryEn: 'A test plugin for verification', needsApiKey: false, isSpam: false, confidence: 0.9,
}
check('accepts a valid label', 'label' in validateLabel(validLabel))
check('rejects a non-object reply', 'errors' in validateLabel('nope'))
const badCat = validateLabel({ ...validLabel, category: 'invented' })
check('an unknown category falls back to other', badCat.label?.category === 'other')
check('the unknown category is reported as drift', badCat.droppedCategory === 'invented')
check('a valid category is not reported as drift', validateLabel(validLabel).droppedCategory === undefined)
const drift = validateLabel({ ...validLabel, tags: ['git', 'not-a-real-tag'] })
check('keeps the label when a tag is invented', 'label' in drift)
check('drops the out-of-vocabulary tag', drift.label?.tags.join(',') === 'git')
check('reports the dropped tag as drift', drift.droppedTags?.join(',') === 'not-a-real-tag')
check('caps tags at six', (validateLabel({ ...validLabel, tags: Array(9).fill('git') }).label?.tags.length ?? 9) <= 6)
check('requires both summaries', 'errors' in validateLabel({ ...validLabel, summaryZh: '' }))
check('clamps confidence', validateLabel({ ...validLabel, confidence: 5 }).label?.confidence === 1)
check('keeps a short readme intact', clipReadme('# Title\n\nShort body.') === '# Title\n\nShort body.')
check('trims a long readme', clipReadme('x'.repeat(20000)).length < 4200)
check('strips image markup', !clipReadme('![alt](https://example.com/a.png)\n\ntext').includes('example.com'))

// A truncated README can end mid-emoji; the resulting lone surrogate makes the
// API reject the whole request with "unexpected end of hex escape".
const { sanitizeForTransport } = await import('../tools/crawler/label.ts')
const lone = `ok${String.fromCharCode(0xD83D)}tail`
check('strips a lone surrogate', !/[\uD800-\uDFFF]/.test(sanitizeForTransport(lone)))
check('sanitized text survives JSON', (() => {
  try { JSON.parse(JSON.stringify({ t: sanitizeForTransport(lone) })); return true } catch { return false }
})())
check('keeps a valid surrogate pair', sanitizeForTransport('hi \u{1F389}') === 'hi \u{1F389}')
check('strips C0 controls', sanitizeForTransport(`a${String.fromCharCode(0)}b`) === 'ab')
check('keeps newline and tab', sanitizeForTransport('a\nb\tc') === 'a\nb\tc')

const { score } = await import('../tools/crawler/score.ts')
const base = { ...goodEntry, readmeBytes: 4000, license: 'MIT' }
const npmScore = score(base).total
const manualScore = score({ ...base, tier: 'likely-plugin', installMethod: 'manual' }).total
check('installable outranks manual', npmScore > manualScore, `${npmScore} vs ${manualScore}`)
const starry = score({ ...base, tier: 'related', installMethod: 'manual', stars: 90000 }).total
check('a 90k-star non-plugin cannot outrank a verified plugin', npmScore > starry, `${npmScore} vs ${starry}`)
check('archived is penalised', score({ ...base, archived: true }).total < npmScore)
check('spam is penalised', score({ ...base, isSpam: true }).total < npmScore)
check(
  'monorepo siblings decay',
  score({ ...base, siblingRank: 3 }).total < score({ ...base, siblingRank: 0 }).total,
)
check('score stays within 0..100', score({ ...base, archived: true, isFork: true, isSpam: true }).total >= 0)

console.log('\n6/6 published catalog on disk')
const catalogPath = new URL('../data/v1/catalog.json', import.meta.url)
if (!existsSync(catalogPath)) {
  console.log('  SKIP  data/v1/catalog.json not generated yet')
} else {
  const parsed = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
  check('published catalog parses', parsed !== undefined)
  check('published catalog is schema-compatible', parsed !== undefined && isCompatible(parsed.meta))
  const verified = (parsed?.entries ?? []).filter(entry => INSTALLABLE_TIERS.includes(entry.tier))
  check('every installable entry carries a spec', verified.every(entry => entry.installSpec !== undefined))
  check('every installable spec is safe', verified.every(entry => isSafeSpec(entry.installSpec)))
  check(
    'every git-installed entry is flagged as running a build script',
    verified.filter(entry => entry.installMethod === 'git').every(entry => entry.runsBuildScript),
  )
  check(
    'no manual entry claims an installable tier',
    (parsed?.entries ?? []).every(entry => !(INSTALLABLE_TIERS.includes(entry.tier) && entry.installMethod === 'manual')),
  )
  check('entry ids are unique', new Set((parsed?.entries ?? []).map(e => e.id)).size === (parsed?.entries ?? []).length)
}

console.log('\n   cache round-trip in a temporary directory')
const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-plugin-hub-verify-'))
try {
  const { CatalogRegistry } = await import('../lib/registry.js')
  const catalogFile = join(stateRoot, 'catalog.json')
  await writeFile(catalogFile, JSON.stringify({ meta: goodMeta, entries: [goodEntry] }), 'utf8')
  const registry = new CatalogRegistry({ registryUrl: '', stateDir: stateRoot, warn: () => {} })
  const snapshot = registry.snapshot()
  check('reads a cached catalog from disk', snapshot.catalog.entries.length === 1)
  check('reports the cache as its source', snapshot.source === 'cache')

  await writeFile(catalogFile, '{ not json', 'utf8')
  const broken = new CatalogRegistry({ registryUrl: '', stateDir: stateRoot, warn: () => {} })
  check('falls back past a corrupt cache', broken.snapshot().source === 'seed')

  // An empty registryUrl never reaches the network. In a working checkout it
  // adopts the catalog the crawler wrote; from an npm install, where `data/`
  // is not in the tarball, there is nothing to adopt and the seed stands.
  let networkCalls = 0
  const realFetchHere = globalThis.fetch
  globalThis.fetch = async (...args) => { networkCalls += 1; return realFetchHere(...args) }
  const offline = await broken.refresh()
  globalThis.fetch = realFetchHere
  check('an empty registryUrl never performs a network fetch', networkCalls === 0)
  check(
    'an empty registryUrl resolves to the local build or the seed, nothing else',
    offline.source === (existsSync(join(process.cwd(), 'data/v1/catalog.json')) ? 'remote' : 'seed'),
    `source was ${offline.source}`,
  )

  // A local registryUrl is how the marketplace reads the catalog the crawler
  // wrote on this machine, before the repository is public.
  const published = join(stateRoot, 'published.json')
  await writeFile(published, JSON.stringify({ meta: goodMeta, entries: [goodEntry] }), 'utf8')
  const localState = join(stateRoot, 'local-state')
  const local = new CatalogRegistry({ registryUrl: published, stateDir: localState, warn: () => {} })
  const loaded = await local.refresh()
  check('loads a catalog from an absolute path', loaded.catalog.entries.length === 1)
  check('an absolute path counts as the published source', loaded.source === 'remote')

  const viaFileUrl = new CatalogRegistry({
    registryUrl: new URL(`file://${published}`).href,
    stateDir: join(stateRoot, 'file-url-state'),
    warn: () => {},
  })
  check('loads a catalog from a file:// URL', (await viaFileUrl.refresh()).catalog.entries.length === 1)

  const missing = new CatalogRegistry({
    registryUrl: join(stateRoot, 'absent.json'),
    stateDir: join(stateRoot, 'missing-state'),
    warn: () => {},
  })
  check('a missing local catalog falls back rather than throwing', (await missing.refresh()).source === 'seed')
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('\n   local catalog source resolution')
{
  const { localSourcePath } = await import('../lib/registry.js')
  check('an https URL is not treated as a path', localSourcePath('https://example.com/c.json') === undefined)
  check('an absolute path resolves', localSourcePath('/tmp/catalog.json') === '/tmp/catalog.json')
  check('a file:// URL resolves', localSourcePath('file:///tmp/catalog.json') === '/tmp/catalog.json')
  // Relative paths would resolve against a cwd the user cannot see from the
  // settings UI, so they are refused instead of guessed at.
  check('a relative path is refused', localSourcePath('data/v1/catalog.json') === undefined)
  check('an empty source is refused', localSourcePath('') === undefined)
}

console.log('\n   README fetch target derivation')
{
  const { isSafeRepo } = await import('../lib/readme.js')
  check('a normal repo passes', isSafeRepo('NanmiCoder/dsh-agent-teams'))
  check('a dotted repo passes', isSafeRepo('owner/repo.js'))
  check('traversal is refused', !isSafeRepo('../../etc/passwd'))
  check('a nested path is refused', !isSafeRepo('owner/repo/extra'))
  check('an absolute URL is refused', !isSafeRepo('https://evil.test/x'))
  check('a query string is refused', !isSafeRepo('owner/repo?x=1'))
  check('a bare name is refused', !isSafeRepo('owner'))
  check('a leading dash is refused', !isSafeRepo('-owner/repo'))
}

console.log('\n   README link admission (rendered README is untrusted text)')
{
  const { safeUrl } = await import('../lib/readme-text.js')
  const base = 'https://raw.githubusercontent.com/owner/repo/HEAD/README.md'
  check('https passes through', safeUrl('https://example.com/a') === 'https://example.com/a')
  check('http passes through', safeUrl('http://example.com/a') === 'http://example.com/a')
  // React escapes text but hands URL attributes to the DOM verbatim, so these
  // are the cases that would otherwise execute.
  check('javascript: is refused', safeUrl('javascript:alert(1)') === undefined)
  check('JaVaScRiPt: is refused', safeUrl('JaVaScRiPt:alert(1)') === undefined)
  check('javascript: with a base is still refused', safeUrl('javascript:alert(1)', base) === undefined)
  check('data: is refused', safeUrl('data:text/html,<script>x</script>') === undefined)
  check('vbscript: is refused', safeUrl('vbscript:msgbox') === undefined)
  check('file: is refused', safeUrl('file:///etc/passwd') === undefined)
  check('a leading-whitespace scheme is refused', safeUrl('  javascript:alert(1)') === undefined)
  check('an anchor is dropped', safeUrl('#install') === undefined)
  check('an empty URL is dropped', safeUrl('   ') === undefined)
  check('a relative path without a base is dropped', safeUrl('docs/a.png') === undefined)
  check(
    'a relative path resolves against the base',
    safeUrl('docs/a.png', base) === 'https://raw.githubusercontent.com/owner/repo/HEAD/docs/a.png',
  )
  check(
    'a root-relative path resolves against the base host',
    safeUrl('/owner/repo/x.png', base) === 'https://raw.githubusercontent.com/owner/repo/x.png',
  )
  check('a protocol-relative URL resolves to https', safeUrl('//example.com/a', base) === 'https://example.com/a')
}

console.log('\n   README HTML is folded into Markdown, never into markup')
{
  const { htmlToMarkdown } = await import('../lib/readme-text.js')
  const md = htmlToMarkdown
  // The shape almost every README opens with.
  check('an html heading becomes a markdown heading', md('<h1 align="center">ModLens</h1>').includes('# ModLens'))
  check('an html heading keeps its level', md('<h3>Setup</h3>').startsWith('### Setup'))
  check('an img becomes a markdown image', md('<img src="a.png" alt="Logo">') === '![Logo](a.png)')
  check('an img without alt still converts', md('<img src="a.png">') === '![](a.png)')
  check('an anchor becomes a markdown link', md('<a href="https://x.test">go</a>') === '[go](https://x.test)')
  check('bold converts', md('<b>hi</b>') === '**hi**')
  check('a br becomes a newline', md('a<br>b') === 'a\nb')
  check('layout tags are dropped but text kept', md('<p align="center">hello</p>') === 'hello')
  check('a comment is removed', md('<!-- hidden -->visible') === 'visible')
  // Output is Markdown source, so no attribute can reach the DOM this way.
  check('script content is removed', !md('<script>alert(1)</script>ok').includes('alert'))
  check('style content is removed', !md('<style>body{}</style>ok').includes('body{'))
  check('an event handler attribute does not survive', !md('<div onclick="alert(1)">x</div>').includes('onclick'))
  check('entities decode', md('a &amp; b &lt;c&gt;') === 'a & b <c>')
  check('a numeric entity decodes', md('&#65;&#x42;') === 'AB')
  check('a malformed entity is left alone', md('&notreal;') === '&notreal;')
  // A README documenting HTML must keep it verbatim inside a fence.
  const fenced = md('text\n\n```html\n<h1 align="center">kept</h1>\n```\n')
  check('html inside a fence survives', fenced.includes('<h1 align="center">kept</h1>'))
  check('html outside the fence still converts', md('<b>a</b>\n\n```\n<b>b</b>\n```').startsWith('**a**'))
  check('plain markdown is unchanged', md('# Title\n\nSome *text*.') === '# Title\n\nSome *text*.')
  check('an empty document stays empty', md('') === '')
}

console.log('\n   the published index carries every field the UI renders')
{
  // `index.json` is the document registryUrl points at in production, and it
  // is a hand-maintained subset of the entry. Dropping a field from it breaks
  // nothing loudly — it just empties part of the detail view for real users —
  // so the subset is asserted against what the client actually reads.
  const RENDERED = [
    // list row
    'id', 'repo', 'tier', 'packageName', 'installMethod', 'installSpec', 'runsBuildScript',
    'description', 'summary', 'stars', 'pushedAt', 'license', 'score',
    'hasClient', 'hasSkills', 'needsApiKey', 'nativeTs', 'tags', 'topics',
    // detail panel
    'owner', 'summaryEn', 'category', 'forks', 'commits',
    'openIssues', 'closedIssues', 'openPullRequests', 'createdAt', 'language',
    'npmVersion', 'latestReleaseTag', 'latestReleaseAt',
  ]
  const indexPath = join(process.cwd(), 'data/v1/index.json')
  if (!existsSync(indexPath)) {
    console.log('  SKIP  no published index on disk')
  } else {
    const rows = JSON.parse(readFileSync(indexPath, 'utf8')).entries ?? []
    // Optional fields are legitimately absent on some rows, so the check is
    // "some row carries it", not "every row does".
    const present = new Set(rows.flatMap(row => Object.keys(row)))
    const missing = RENDERED.filter(field => !present.has(field))
    check(
      'index.json carries every field the client renders',
      missing.length === 0,
      `missing: ${missing.join(', ')} — regenerate with pnpm crawl`,
    )
    check(
      'index.json omits what the client rebuilds (url, manualSteps)',
      !present.has('url') && !present.has('manualSteps'),
    )
  }
}

console.log('\n   README inline tokenizing')
{
  const { INLINE } = await import('../lib/readme-text.js')
  const first = s => INLINE.exec(s)?.[0]
  // The bug this guards: the plain-link pattern matches a PREFIX of a badge,
  // so `[![npm](img)](link)` tokenizes as a link to the image URL and leaves
  // `](link)` behind as literal text. Badges open most READMEs.
  const badge = '[![npm](https://img.shields.io/npm/v/x.svg)](https://npmjs.com/package/x)'
  check('a badge is one token, not a truncated link', first(badge) === badge)
  check('a bare image still tokenizes', first('![a](b.png)') === '![a](b.png)')
  check('a bare link still tokenizes', first('[a](https://b.test)') === '[a](https://b.test)')
  check('inline code wins over emphasis inside it', first('`a *b* c`') === '`a *b* c`')
  check('bold tokenizes before italic', first('**bold**') === '**bold**')
  check('an autolink tokenizes', first('<https://a.test/x>') === '<https://a.test/x>')
  check('plain text yields no token', INLINE.exec('just words') === null)
  // A global flag would make exec() stateful across calls and skip matches.
  check('the pattern is not global (exec must not carry lastIndex)', !INLINE.global)
}

console.log('\n   GitHub topics survive a catalog round trip')
{
  const withTopics = parseCatalog({
    meta: goodMeta,
    entries: [{ ...goodEntry, topics: ['dsh-plugin', 'deepseek', 42, null] }],
  })
  check('topics are parsed', withTopics?.entries[0]?.topics.length === 2)
  check('non-string topics are dropped', !withTopics?.entries[0]?.topics.includes(42))
  // Catalogs published before topics existed must still render.
  const legacy = parseCatalog({ meta: goodMeta, entries: [goodEntry] })
  check('a catalog without topics still parses', legacy?.entries.length === 1)
  check('a missing topics field becomes an empty list', Array.isArray(legacy?.entries[0]?.topics))
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
