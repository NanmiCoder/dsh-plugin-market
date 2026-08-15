#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(manifest.name === '@nanmicoder/dsh-plugin-market', 'unexpected npm package name')
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'package version must be plain semver')
assert(manifest.private !== true, 'publishable package must not be private')
assert(manifest.license === 'MIT', 'package license must be MIT')
assert(
  manifest.repository?.url === 'git+https://github.com/NanmiCoder/dsh-plugin-market.git',
  'repository URL must match the GitHub OIDC publisher repository exactly',
)
assert(manifest.publishConfig?.access === 'public', 'scoped package must publish publicly')
assert(manifest.publishConfig?.registry === 'https://registry.npmjs.org/', 'unexpected publish registry')
assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'DSH bundle patch is missing')
assert(manifest.scripts?.prepublishOnly === 'pnpm build && pnpm verify', 'prepublish verification is missing')
assert(
  manifest.dependencies?.['@deepseek-ai/schemastery'] === '^3.18.1-rc.1',
  'schemastery must ship as a runtime dependency',
)

for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  assert(
    manifest.peerDependenciesMeta?.[peer]?.optional === true,
    `host-provided peer must be optional for standalone installs: ${peer}`,
  )
}

for (const path of ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'README.md', 'README_ZH.md']) {
  assert(existsSync(new URL(`../${path}`, import.meta.url)), `published artifact is missing: ${path}`)
}

const requiredFiles = ['lib', 'assets', 'cordis.patch.yml', 'README.md', 'README_ZH.md']
for (const path of requiredFiles) {
  assert(manifest.files?.includes(path), `package files whitelist is missing: ${path}`)
}

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const readmeZh = readFileSync(new URL('../README_ZH.md', import.meta.url), 'utf8')
for (const [label, content] of [['README.md', readme], ['README_ZH.md', readmeZh]]) {
  assert(content.includes('dsh plugin --profile web add @nanmicoder/dsh-plugin-market'), `${label} has a stale install command`)
}

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
assert(workflow.includes("- 'v*.*.*'"), 'publish workflow must be tag-gated')
assert(workflow.includes('id-token: write'), 'publish workflow lacks OIDC permission')
assert(workflow.includes("github.repository == 'NanmiCoder/dsh-plugin-market'"), 'publish workflow lacks repository fence')

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
assert(
  patch.includes("name: '@nanmicoder/dsh-plugin-market'"),
  'bundle patch must import the published npm package name',
)
assert(!patch.includes('name: dsh-plugin-hub'), 'bundle patch still imports the obsolete package name')

const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
assert(
  /id:\s*["']@nanmicoder\/dsh-plugin-market["']/.test(clientBundle),
  'browser bundle must register under the published npm package name',
)

console.log(`package contract verified: ${manifest.name}@${manifest.version}`)
