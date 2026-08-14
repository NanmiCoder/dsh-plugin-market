/**
 * Deterministic classification: decide what a candidate is, and whether it can
 * actually be installed, using rules only. No model runs here — this layer is
 * what the "verified" badge means, so it has to be reproducible and auditable.
 *
 * The install rules encode a measured fact rather than an assumption: in a
 * 40-repository sample, 29 declared `dsh.bundle` but only 3 had a `prepare`
 * script. pnpm does not build a git dependency without one, and every plugin
 * gitignores its `lib/`, so a `github:` install of the other 26 would place a
 * package whose entry point does not exist. Publishing to npm is what makes a
 * plugin installable; everything else is a manual clone-and-build.
 */

import { DIRECTORY_DENYLIST, TOPICS, UPSTREAM_REPOS } from './config.ts'
import type { Candidate, PackageManifest, RawRepo } from './types.ts'
import type { InstallMethod, Tier } from '../../src/types.ts'

/** Signals extracted from one candidate. */
export interface Signals {
  /** Manifest declares `dsh.bundle.patch`. */
  readonly hasBundle: boolean
  /** A `cordis.patch.yml` exists and parses as a patch list. */
  readonly hasValidPatch: boolean
  /** Manifest declares a browser half. */
  readonly hasClient: boolean
  /** Depends on any `@deepseek-ai/*` package. */
  readonly dependsOnDsh: boolean
  /** Published on npm. */
  readonly onNpm: boolean
  /** The npm manifest itself declares `dsh.bundle` — the authoritative signal. */
  readonly npmHasBundle: boolean
  /** Carries a build script pnpm will run for a git dependency. */
  readonly hasPrepare: boolean
  /** Marked private, so it can never be published. */
  readonly isPrivate: boolean
  readonly hasSkills: boolean
  readonly hasBin: boolean
  readonly hasEntry: boolean
  readonly declaresDshKeyword: boolean
}

/** The verdict for one candidate. */
export interface Classification {
  readonly tier: Tier
  readonly installMethod: InstallMethod
  readonly installSpec?: string
  readonly runsBuildScript: boolean
  readonly manualSteps?: string[]
  readonly reason: string
  readonly capabilities: {
    readonly hasClient: boolean
    readonly hasSkills: boolean
    readonly needsApiKey: boolean
  }
}

/**
 * Whether a `cordis.patch.yml` is a usable patch list.
 *
 * DSH rejects anything that is not a top-level YAML array, so an empty or
 * object-rooted file is a broken plugin, not a plugin with no patches. Checked
 * by shape rather than a YAML parse to keep the crawler dependency-free.
 * @param text - the file contents.
 * @returns true when the file looks like a patch list.
 */
export function isValidPatchFile(text: string | undefined): boolean {
  if (text === undefined) return false
  const meaningful = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  if (meaningful.length === 0) return false
  // A top-level array: the first meaningful line must open a sequence entry.
  if (!meaningful[0]?.startsWith('- ')) return false
  return meaningful.some(line => /^-?\s*(insert|remove|replace|id|name):/.test(line))
}

/**
 * Parse a manifest, tolerating malformed JSON.
 * @param text - the raw package.json.
 * @returns the manifest, or undefined when unparsable.
 */
export function parseManifest(text: string | undefined): PackageManifest | undefined {
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as PackageManifest : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a repository looks like a monorepo worth a second pass.
 * @param repo - the repository.
 * @param manifest - its root manifest, if any.
 * @returns the candidate directories to probe, empty when not worth probing.
 */
export function monorepoDirectories(repo: RawRepo, manifest: PackageManifest | undefined): string[] {
  const entries = repo.rootTree?.entries ?? []
  const directories = entries
    .filter(entry => entry.type === 'tree' && !DIRECTORY_DENYLIST.has(entry.name) && !entry.name.startsWith('.'))
    .map(entry => entry.name)
  if (directories.length === 0) return []
  // A root manifest that already declares a bundle needs no expansion.
  if (manifest?.dsh?.bundle?.patch !== undefined) return []
  const workspaceHint = manifest?.workspaces !== undefined
    || entries.some(entry => entry.name === 'pnpm-workspace.yaml')
  const conventional = directories.filter(name => ['packages', 'plugins', 'apps', 'bundles', 'extensions'].includes(name))
  // Probe conventional workspace roots first, then any other plausible
  // directory: observed layouts include `plugin/`, `bundle/`, and a directory
  // named after the repository itself.
  if (conventional.length > 0 || workspaceHint) return [...new Set([...conventional, ...directories])].slice(0, 8)
  if (manifest === undefined) return directories.slice(0, 8)
  return []
}

/**
 * Extract the signals used by {@link classify}.
 * @param candidate - the candidate under test.
 * @returns its signals.
 */
export function extractSignals(candidate: Candidate): Signals {
  const manifest = candidate.manifest
  const dependencies = { ...manifest?.dependencies, ...manifest?.peerDependencies }
  const entries = candidate.repo.rootTree?.entries ?? []
  return {
    hasBundle: manifest?.dsh?.bundle?.patch !== undefined,
    hasValidPatch: isValidPatchFile(candidate.patchText),
    hasClient: manifest?.dsh?.client !== undefined || manifest?.dshClient !== undefined,
    dependsOnDsh: Object.keys(dependencies).some(name => name.startsWith('@deepseek-ai/')),
    onNpm: candidate.npm !== undefined,
    npmHasBundle: candidate.npm?.hasDshBundle === true,
    hasPrepare: typeof manifest?.scripts?.prepare === 'string',
    isPrivate: manifest?.private === true,
    hasSkills: entries.some(entry => entry.name === 'skills') || (manifest?.files ?? []).includes('skills'),
    hasBin: manifest?.bin !== undefined,
    hasEntry: manifest?.main !== undefined || manifest?.exports !== undefined,
    declaresDshKeyword: (manifest?.keywords ?? []).some(keyword => (TOPICS as readonly string[]).includes(keyword)),
  }
}

/**
 * Detect whether a plugin will ask the user for credentials.
 * @param candidate - the candidate.
 * @returns true when an API key is likely required.
 */
function detectNeedsApiKey(candidate: Candidate): boolean {
  const patchKeys = candidate.patchText ?? ''
  if (/^\s*[a-zA-Z]*(apiKey|api_key|token|secret|password|credential)\s*:/im.test(patchKeys)) return true
  const readme = candidate.readme?.text ?? ''
  return /\b(API[ _-]?KEY|ACCESS[ _-]?TOKEN|[A-Z][A-Z0-9]{2,}_(?:API_)?(?:KEY|TOKEN|SECRET))\b/.test(readme)
    || /密钥|令牌|申请.{0,4}key/i.test(readme)
}

/**
 * Classify a candidate and decide how it can be installed.
 * @param candidate - the candidate.
 * @param signals - its extracted signals.
 * @returns the verdict.
 */
export function classify(candidate: Candidate, signals: Signals): Classification | undefined {
  const repo = candidate.repo
  const capabilities = {
    hasClient: signals.hasClient,
    hasSkills: signals.hasSkills,
    needsApiKey: detectNeedsApiKey(candidate),
  }
  const manual = (reason: string): Classification => ({
    tier: 'likely-plugin',
    installMethod: 'manual',
    runsBuildScript: false,
    manualSteps: manualSteps(candidate),
    reason,
    capabilities,
  })

  // Hard rejects first, so the expensive stages never see them.
  if (repo.isEmpty) return undefined
  if (repo.isMirror) return undefined
  if (repo.isFork && repo.stargazerCount === 0 && !signals.hasBundle && !signals.hasValidPatch) return undefined
  if (UPSTREAM_REPOS.has(repo.nameWithOwner) && !signals.hasBundle) {
    return { tier: 'related', installMethod: 'manual', runsBuildScript: false, reason: 'upstream', capabilities }
  }
  if (repo.isArchived && !signals.npmHasBundle && !(signals.hasBundle && signals.hasValidPatch)) return undefined

  // The npm manifest is authoritative: it describes exactly what pnpm will
  // place in the profile, which the repository's HEAD may not.
  if (signals.npmHasBundle && candidate.npm !== undefined) {
    return {
      tier: 'verified-npm',
      installMethod: 'npm',
      installSpec: candidate.npm.name,
      runsBuildScript: false,
      reason: 'npm manifest declares dsh.bundle',
      capabilities: { ...capabilities, hasClient: capabilities.hasClient || candidate.npm.hasClient },
    }
  }

  if (signals.hasBundle && signals.hasValidPatch) {
    // Unpublished. Only a prepare script makes a git install produce a
    // loadable package; without one the entry point is never built.
    if (signals.hasPrepare && candidate.subdir === undefined) {
      const [owner, name] = repo.nameWithOwner.split('/')
      return {
        tier: 'verified-git',
        installMethod: 'git',
        installSpec: `github:${owner}/${name}`,
        runsBuildScript: true,
        reason: 'dsh.bundle + valid patch + prepare script',
        capabilities,
      }
    }
    return manual(signals.isPrivate
      ? 'declares dsh.bundle but is marked private, so it cannot be published'
      : 'declares dsh.bundle but has no prepare script, so pnpm cannot build it from git')
  }

  // Plugin-shaped but missing a required half.
  if (signals.hasBundle) return manual('declares dsh.bundle but its cordis.patch.yml is missing or invalid')
  if (signals.hasValidPatch) return manual('ships a cordis.patch.yml but declares no dsh.bundle')
  if (signals.dependsOnDsh && signals.hasEntry) return manual('depends on the DSH runtime and exposes an entry point')
  if (signals.onNpm && signals.declaresDshKeyword) return manual('published to npm under a DSH keyword')

  // Ecosystem-adjacent: worth listing, never installable as a bundle.
  const related = (reason: string): Classification => ({
    tier: 'related', installMethod: 'manual', runsBuildScript: false, reason, capabilities,
  })
  if (signals.hasBin) return related('command-line tool')
  if (signals.hasSkills) return related('skills pack')
  if (repo.repositoryTopics.nodes.some(node => (TOPICS as readonly string[]).includes(node.topic.name))) {
    return related('carries an ecosystem topic but ships no bundle')
  }
  return undefined
}

/**
 * Build clone-and-build instructions for a candidate.
 * @param candidate - the candidate.
 * @returns the shell steps.
 */
function manualSteps(candidate: Candidate): string[] {
  const repo = candidate.repo.nameWithOwner
  const directory = repo.split('/')[1] ?? repo
  const target = candidate.subdir === undefined ? directory : `${directory}/${candidate.subdir}`
  return [
    `git clone https://github.com/${repo}.git`,
    `cd ${target}`,
    'pnpm install && pnpm build',
    'dsh plugin --profile web add $(pwd)',
  ]
}
