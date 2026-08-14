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

console.log('\n4b/6 slice planning')
const { planSlices } = await import('../tools/crawler/github.ts')
// A client that keeps declaring "too many" until three date splits have been
// applied, forcing the planner to recurse on both halves.
const splitting = { count: async q => ((q.match(/created:/g) ?? []).length >= 3 ? 10 : 900) }
const planned = await planSlices('topic:x', splitting, () => {})
const splitDates = [...new Set(planned.flatMap(q =>
  [...q.matchAll(/created:[<>=]+(\d{4}-\d{2}-\d{2})/g)].map(m => m[1])))].sort()
check('planner splits oversized slices', planned.length > 6)
check('every planned slice is a query string', planned.every(q => typeof q === 'string' && q.startsWith('topic:x')))
// The bug this guards: deriving the split window from recursion depth instead
// of threading it through makes every split land in the same recent span, so
// the older half never narrows and its repositories are silently lost.
check(
  'both halves narrow within their own window',
  splitDates.length >= 5 && splitDates[0] < '2025-07-01' && splitDates[splitDates.length - 1] > '2025-12-01',
  `split dates: ${splitDates.join(', ')}`,
)
const neverStops = { count: async () => 5000 }
const bounded = await planSlices('topic:x', neverStops, () => {})
check('planner terminates when a window cannot be split', bounded.length > 0 && bounded.length < 500)

console.log('\n5/6 label validation and scoring')
const { validateLabel, clipReadme } = await import('../tools/crawler/label.ts')
const validLabel = {
  category: 'coding', tags: ['git', 'code-review'], summaryZh: '一个测试插件',
  summaryEn: 'A test plugin for verification', needsApiKey: false, isSpam: false, confidence: 0.9,
}
check('accepts a valid label', 'label' in validateLabel(validLabel))
check('rejects a non-object reply', 'errors' in validateLabel('nope'))
check('rejects an unknown category', 'errors' in validateLabel({ ...validLabel, category: 'invented' }))
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

  const offline = await broken.refresh()
  check('an empty registryUrl performs no fetch', offline.source === 'seed')
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
