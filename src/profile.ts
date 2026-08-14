/**
 * Profile-directory access: locate the running profile, read and write its
 * manifest, and reconcile the `dsh.profile.bundles` layer list.
 *
 * The reconcile rule is a port of `dsh plugin`'s own
 * (`apps/cli/src/plugin.ts:59-91`), kept behaviourally identical so a plugin
 * installed from this marketplace is indistinguishable from one installed on
 * the command line: reconcile by INSTALLED STATE, not by dependency diff, so a
 * package that gains its `dsh.bundle` declaration in a newer version becomes a
 * layer on the next update.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readProfileManifest,
  resolveBundleDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'

/** Diagnostic prefix on app-boot errors, matching the CLI's. */
const NAME = 'dsh'

/**
 * This package's own manifest path, used as the first bundle-resolution
 * anchor. It rarely resolves anything (installed plugins live under the
 * profile), but `resolveBundleDir` tries the profile anchor next, which does.
 */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The subset of an installed plugin's package.json this plugin reads. */
export interface InstalledPackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dsh?: { bundle?: { patch?: string }, client?: unknown }
  readonly dshClient?: unknown
}

/**
 * Locate the profile directory of the running host.
 *
 * The loader anchors `ctx.baseUrl` at the directory holding the composed root
 * config, which is the profile directory itself
 * (`app-boot/src/index.ts` sets it from `dirname(absoluteConfigPath)`), so no
 * profile-name guessing or `$DSH_HOME` reconstruction is needed.
 * @param baseUrl - the context's `baseUrl`, if the loader set one.
 * @param override - an explicit configuration escape hatch.
 * @returns the absolute profile directory.
 * @throws when neither source yields a directory holding a package.json.
 */
export function resolveProfileDirectory(baseUrl: string | undefined, override?: string): string {
  const candidate = override !== undefined && override !== ''
    ? override
    : baseUrl === undefined ? undefined : safeFileUrlToPath(baseUrl)
  if (candidate === undefined) {
    throw new Error(
      'plugin-hub: cannot locate the profile directory — the loader set no baseUrl; '
      + 'set the `profileDir` config option to the absolute path of your profile',
    )
  }
  if (!existsSync(join(candidate, 'package.json'))) {
    throw new Error(
      `plugin-hub: ${candidate} holds no package.json, so it is not a profile directory; `
      + 'set the `profileDir` config option to the absolute path of your profile',
    )
  }
  return candidate
}

/**
 * Convert a file URL to a path without throwing on a non-file URL.
 * @param url - the candidate URL.
 * @returns the path, or undefined when the URL is not a usable file URL.
 */
function safeFileUrlToPath(url: string): string | undefined {
  try {
    // A trailing slash yields a path with one too; join() tolerates it.
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

/**
 * Read a profile's package.json.
 * @param profileDir - the profile directory.
 * @returns the parsed manifest.
 */
export function readManifest(profileDir: string): ProfileManifest {
  return readProfileManifest(NAME, profileDir)
}

/**
 * Read an installed package's own manifest.
 * @param profileDir - the profile the package is installed into.
 * @param packageName - the dependency name.
 * @returns the manifest, or undefined when the package does not resolve.
 */
export function readInstalledPackage(
  profileDir: string, packageName: string,
): InstalledPackageManifest | undefined {
  const dir = bundleDirectory(profileDir, packageName)
  if (dir === undefined) return undefined
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as InstalledPackageManifest
  } catch {
    return undefined
  }
}

/**
 * Resolve an installed package's directory.
 * @param profileDir - the profile directory (second resolution anchor).
 * @param packageName - the dependency name.
 * @returns the absolute directory, or undefined when unresolvable.
 */
export function bundleDirectory(profileDir: string, packageName: string): string | undefined {
  try {
    return resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return undefined
  }
}

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param profileDir - the profile directory.
 * @param packageName - the dependency name.
 * @returns true when the package manifest declares `dsh.bundle.patch`.
 */
export function isBundlePackage(profileDir: string, packageName: string): boolean {
  const dir = bundleDirectory(profileDir, packageName)
  if (dir === undefined) return false // pnpm reported success yet it is unresolvable — treat as plain
  return readProfileManifest(NAME, dir).dsh?.bundle?.patch !== undefined
}

/**
 * Whether an installed package ships a browser half.
 *
 * Both manifest shapes count: the current deployment's client-module scanner
 * reads the top-level `dshClient` key while newer builds read nested
 * `dsh.client`, and plugins in the wild declare one, the other, or both.
 * @param manifest - the installed package's manifest.
 * @returns true when a browser bundle will need the page reloaded.
 */
export function declaresClient(manifest: InstalledPackageManifest | undefined): boolean {
  if (manifest === undefined) return false
  return manifest.dsh?.client !== undefined || manifest.dshClient !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state.
 *
 * pnpm has already written the real installed names, so a git or tarball spec
 * reconciles by its true package name. A dependency resolving to a
 * `dsh.bundle`-declaring package joins the layer stack (appended in dependency
 * order); a dependency-listed name that no longer does leaves it. Template
 * bundles are not dependencies and are never touched.
 * @param before - the manifest as it was before pnpm ran.
 * @param profileDir - the profile directory.
 * @returns the bundle names added and removed by this reconcile.
 */
export function reconcileBundles(
  before: ProfileManifest, profileDir: string,
): { added: string[], removed: string[] } {
  const after = readManifest(profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const bundles = after.dsh?.profile?.bundles ?? []
  const added: string[] = []
  const removed: string[] = []
  for (const packageName of dependencies) {
    if (isBundlePackage(profileDir, packageName) && !bundles.includes(packageName)) {
      bundles.push(packageName)
      added.push(packageName)
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...bundles]) {
    // Only dependency-managed entries are subject to removal; template bundles
    // (dsh-base and friends) are not dependencies and must survive.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && isBundlePackage(profileDir, packageName)
    if (wasDependency && !stillBundle) {
      bundles.splice(bundles.indexOf(packageName), 1)
      removed.push(packageName)
    }
  }
  if (added.length > 0 || removed.length > 0) {
    after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles } }
    writeProfileManifest(profileDir, after)
  }
  return { added, removed }
}
