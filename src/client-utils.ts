/**
 * Client-side helpers shared by both tsc programs.
 *
 * Lives outside `src/client` so the offline smoke checks can import it: a
 * comparison that is only exercised in a browser cannot be regressed.
 */

/**
 * Whether a README's install command and the verified spec name the same thing.
 *
 * `npm i @foo/bar`, `pnpm add @foo/bar`, and `pnpm i @foo/bar@latest` all
 * install the same package; only the package identity matters, not the
 * package-manager spelling or an attached version.
 * @param command - the README's command, verbatim.
 * @param spec - the verified install spec.
 * @returns true when both point at the same package or repository.
 */
export function sameInstallTarget(command: string, spec: string | undefined): boolean {
  if (spec === undefined) return false
  // The package name or repository is the identity, not the tool that named
  // it. `npm i @x`, `pnpm add @x`, and `dsh plugin add @x` all install @x.
  const fromCommand = /(?:npm|pnpm|yarn|bun|dsh)\s+(?:\S+\s+)*?(?:i|install|add)\s+(\S+)/.exec(command)?.[1]
  if (fromCommand !== undefined) {
    // Strip a version suffix so `@foo/bar` and `@foo/bar@1.2.3` compare equal.
    const bare = (value: string): string => value.replace(/@[\d.^~]*$/, '')
    if (bare(fromCommand) === bare(spec)) return true
  }
  const fromGit = /(?:github\.com\/|github:)([\w.-]+\/[\w.-]+)/.exec(command)?.[1]
  if (fromGit !== undefined) return spec.endsWith(fromGit) || spec.endsWith(fromGit.toLowerCase())
  return false
}

