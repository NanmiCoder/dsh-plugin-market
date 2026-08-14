/** Internal pipeline types. The published shape lives in `src/types.ts`. */

/** A repository as returned by the discovery query. */
export interface RawRepo {
  readonly databaseId: number
  readonly nameWithOwner: string
  readonly description: string | null
  readonly homepageUrl: string | null
  readonly isArchived: boolean
  readonly isFork: boolean
  readonly isMirror: boolean
  readonly isEmpty: boolean
  readonly createdAt: string
  readonly pushedAt: string
  readonly stargazerCount: number
  readonly forkCount: number
  readonly licenseInfo: { spdxId: string } | null
  readonly primaryLanguage: { name: string } | null
  readonly repositoryTopics: { nodes: { topic: { name: string } }[] }
  readonly openIssues: { totalCount: number }
  readonly closedIssues: { totalCount: number }
  readonly openPRs: { totalCount: number }
  readonly releases: { totalCount: number, nodes: { tagName: string, publishedAt: string }[] }
  readonly defaultBranchRef: {
    target: { committedDate?: string, history?: { totalCount: number } } | null
  } | null
  readonly pkg: { text: string } | null
  readonly patchYml: { text: string } | null
  readonly rootTree: { entries: { name: string, type: string }[] } | null
}

/** The subset of a package.json the pipeline reads. */
export interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly private?: boolean
  readonly description?: string
  readonly keywords?: string[]
  readonly main?: string
  readonly bin?: unknown
  readonly files?: string[]
  readonly exports?: unknown
  readonly scripts?: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly workspaces?: unknown
  readonly repository?: { url?: string, directory?: string } | string
  readonly dsh?: { bundle?: { patch?: string }, client?: unknown }
  readonly dshClient?: unknown
}

/** What the npm registry knows about a package. */
export interface NpmFacts {
  readonly name: string
  readonly version: string
  readonly hasDshBundle: boolean
  readonly hasClient: boolean
  readonly repositoryUrl?: string
  readonly weeklyDownloads?: number
}

/** A candidate plugin: one repository, or one directory inside one. */
export interface Candidate {
  readonly repo: RawRepo
  /** Directory within the repository, for monorepo children. */
  readonly subdir?: string
  readonly manifest?: PackageManifest
  /** Raw `cordis.patch.yml` text for this candidate's directory. */
  readonly patchText?: string
  npm?: NpmFacts
  readme?: { text: string, sha: string }
}

/** A label produced by the model. */
export interface Label {
  readonly category: string
  readonly tags: string[]
  readonly summaryZh: string
  readonly summaryEn: string
  readonly needsApiKey: boolean
  readonly isSpam: boolean
  readonly confidence: number
}

/** A cached label plus the key that validates it. */
export interface CachedLabel extends Label {
  readonly key: string
  readonly stale?: boolean
}
