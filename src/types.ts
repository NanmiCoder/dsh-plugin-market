/**
 * Catalog wire types, shared by the host and the browser halves.
 *
 * This module is compiled into BOTH tsc programs, so it must stay
 * import-free: pulling in a host-side package here would drag the host's
 * `Context` declaration merge into the browser program, where the client
 * runtime declares the same members with different types.
 */

/**
 * How confidently an entry can be installed.
 *
 * The tiers encode a measured reality rather than a wish. In a 40-repository
 * sample of the `dsh-plugin` topic, 29 declared `dsh.bundle` but only 3
 * carried a `prepare` script — and without one, pnpm never builds a git
 * dependency, so `main: lib/index.js` (gitignored in every plugin) is missing
 * and the plugin fails to load. A git spec is therefore NOT generally usable,
 * and publishing to npm is what actually makes a plugin installable.
 *
 * - `verified-npm`: the npm registry's own manifest declares `dsh.bundle`.
 *   This is the authoritative signal — it describes exactly what pnpm will
 *   place in the profile — and the only high-confidence one-click install.
 * - `verified-git`: unpublished, but declares `dsh.bundle`, ships a valid
 *   `cordis.patch.yml`, AND has a `prepare` script, so pnpm can build it from
 *   git. Rare (~8%), and installing runs the repository's code at install time.
 * - `likely-plugin`: carries plugin signals (a monorepo child, `private: true`,
 *   or no prepare script) but nothing that can be installed unattended —
 *   listed with manual clone-and-build instructions.
 * - `related`: ecosystem-adjacent (skills packs, CLIs, docs) with no bundle to
 *   mount — listed, never installable.
 */
export type Tier = 'verified-npm' | 'verified-git' | 'likely-plugin' | 'related'

/** How an entry reaches the profile. */
export type InstallMethod = 'npm' | 'git' | 'manual'

/** Tiers the install route will act on. */
export const INSTALLABLE_TIERS: readonly Tier[] = ['verified-npm', 'verified-git']

/** The catalog shape this build understands; see `isCompatible`. */
export const SUPPORTED_SCHEMA_VERSION = 1

/** One curated plugin entry. */
export interface CatalogEntry {
  /** Stable key: lowercased `owner/repo`. */
  readonly id: string
  /** `owner/repo` as GitHub spells it. */
  readonly repo: string
  readonly owner: string
  readonly url: string
  readonly tier: Tier
  /** npm package name from the resolved manifest, when there is one. */
  readonly packageName?: string
  readonly installMethod: InstallMethod
  /**
   * The argument to hand pnpm. Absent means "not auto-installable"; the host
   * re-derives this from its own catalog copy and never trusts a client value.
   */
  readonly installSpec?: string
  /** True when installing runs the repository's build script (git specs). */
  readonly runsBuildScript: boolean
  /** Shown when `installMethod` is `manual`: the clone-and-build recipe. */
  readonly manualSteps?: readonly string[]
  /**
   * The install instruction as the README wrote it — the author's own words,
   * not a command this plugin will execute. The host verifies it separately
   * before acting; it exists so the UI can say "the author recommends X" and
   * the confirmation dialog can show the verified command instead.
   */
  readonly installHint?: {
    /** npm package, git repository, or manual-only. */
    readonly method: 'npm' | 'git' | 'manual'
    /** The command as written, verbatim. */
    readonly command: string
  }
  readonly description: string
  /** One-line LLM summary. */
  readonly summary?: string
  readonly summaryEn?: string
  readonly category?: string
  /**
   * Labels the model chose from a closed vocabulary.
   *
   * Deliberately separate from {@link topics}: these are comparable across the
   * whole catalog because the vocabulary is fixed, which is what makes them
   * usable as filters. They are not what the author wrote.
   */
  readonly tags: readonly string[]
  /**
   * The repository's own GitHub topics, verbatim and unfiltered.
   *
   * This is authorship, not inference — the author's own words about their
   * project — so it is never merged into `tags` and never rewritten. An empty
   * array means the repository carries no topics at all.
   */
  readonly topics: readonly string[]
  readonly stars: number
  readonly forks: number
  readonly openIssues: number
  readonly closedIssues: number
  readonly openPullRequests: number
  readonly commits: number
  readonly pushedAt: string
  readonly createdAt: string
  readonly license?: string
  readonly language?: string
  readonly archived: boolean
  readonly isFork: boolean
  readonly latestReleaseTag?: string
  readonly latestReleaseAt?: string
  readonly npmVersion?: string
  /** Declares `dsh.client`/`dshClient`: installing it requires a page reload. */
  readonly hasClient: boolean
  readonly hasSkills: boolean
  readonly needsApiKey: boolean
  /**
   * The declared entry point is plain TypeScript that Node 26's strip-only
   * loader runs without a build step, so a git install is already loadable.
   */
  readonly nativeTs: boolean
  /** Composite ranking score; the formula is documented in README.md. */
  readonly score: number
  /** Labels were reused from cache because the labelling pass failed. */
  readonly labelStale?: boolean
}

/** Provenance for one catalog build. */
export interface CatalogMeta {
  readonly schemaVersion: number
  readonly generatedAt: string
  readonly count: number
  readonly contentHash: string
}

/** A full catalog document, as published and as cached. */
export interface Catalog {
  readonly meta: CatalogMeta
  readonly entries: readonly CatalogEntry[]
}

/** Where the catalog currently in memory came from. */
export type CatalogSource = 'remote' | 'cache' | 'seed'

/** Whether an entry is present in the running profile. */
export type InstallState = 'installed' | 'not-installed' | 'pending-reload'

/** A catalog entry joined with this profile's installation state. */
export interface CatalogEntryView extends CatalogEntry {
  readonly installState: InstallState
  readonly installedVersion?: string
}

/** Response body of `GET /catalog`. */
export interface CatalogResponse {
  readonly entries: readonly CatalogEntryView[]
  readonly meta: CatalogMeta
  readonly source: CatalogSource
  /** False when `allowInstall` is off: the UI must hide every action. */
  readonly installEnabled: boolean
  /** Set when the published schema is newer than this build understands. */
  readonly upgradeRequired?: boolean
}

/**
 * Response body of `GET /readme`.
 *
 * READMEs are fetched on demand rather than published into the catalog: at
 * ~8 KB each, 1984 of them would add 16 MB to a document the browser parses on
 * every open. Fetching per entry also means the text is current rather than as
 * old as the last crawl.
 */
export interface ReadmeResponse {
  readonly ok: boolean
  /** Raw Markdown, as written by the repository author. */
  readonly markdown: string
  /** Absolute URL the Markdown came from, for resolving relative links. */
  readonly sourceUrl?: string
  /** Set when the fetch failed; the UI shows the repository link instead. */
  readonly message?: string
}

/** Response body of the install and uninstall routes. */
export interface MutationResponse {
  readonly ok: boolean
  /** The plugin declared a browser half: the page must be reloaded. */
  readonly needsReload: boolean
  readonly message: string
  /** pnpm's combined output, surfaced verbatim on failure. */
  readonly detail?: string
}

/**
 * Whether a published catalog can be read by this build.
 *
 * Forward guard: a newer major schema is refused rather than half-parsed, so
 * an older installed plugin keeps serving its cached data instead of
 * rendering a broken marketplace.
 * @param meta - the incoming catalog's metadata.
 * @returns true when this build understands the document.
 */
export function isCompatible(meta: CatalogMeta): boolean {
  return Number.isFinite(meta.schemaVersion) && meta.schemaVersion <= SUPPORTED_SCHEMA_VERSION
}
