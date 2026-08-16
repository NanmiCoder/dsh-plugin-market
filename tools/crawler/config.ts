/**
 * Pipeline configuration: discovery channels, the controlled label vocabulary,
 * and the scoring weights. This is the single source of truth for every knob
 * the crawler exposes, so a policy change is one edit here rather than a hunt
 * through the stages.
 */

/** GitHub topics swept for candidates. */
export const TOPICS = ['dsh-plugin', 'deepseek-harness', 'dsh'] as const

/** npm keywords swept as a second discovery channel. */
export const NPM_KEYWORDS = ['dsh-plugin', 'deepseek-harness', 'dsh', 'dsh-bundle'] as const

/**
 * Star buckets used to stay under GitHub's 1000-result search ceiling.
 *
 * The ceiling is enforced silently — past it, search returns an empty node
 * list with `hasNextPage: false` rather than an error — so slices are kept
 * well below it and every drain asserts it collected what was declared.
 */
export const STAR_BUCKETS = [
  'stars:0',
  'stars:1..2',
  'stars:3..9',
  'stars:10..49',
  'stars:50..199',
  'stars:>=200',
] as const

/** Split a slice further once it declares more than this many repositories. */
export const SPLIT_THRESHOLD = 800

/** GitHub's hard search ceiling, for the drain invariant. */
export const SEARCH_CEILING = 1000

/**
 * Repositories per search page.
 *
 * Measured: the full field set at 50 per page makes the endpoint 502 under
 * load — no single field is responsible, the combined response simply exceeds
 * what it will assemble. The rate-limit cost is 1 point per request whatever
 * the page size, so a smaller page costs only extra round trips.
 */
export const PAGE_SIZE = 25

/** Bytes of README pulled per candidate (via a ranged raw request). */
export const README_BYTES = 32768

/** README filenames tried, in order. */
export const README_CANDIDATES = [
  'README.md', 'README.zh.md', 'README_CN.md', 'README.zh-CN.md', 'readme.md', 'README.rst',
] as const

/** Directories never treated as a candidate plugin package. */
export const DIRECTORY_DENYLIST = new Set([
  '.github', '.vscode', '.husky', '.changeset', '.idea', 'node_modules',
  'docs', 'doc', 'examples', 'example', 'test', 'tests', '__tests__', 'spec',
  'scripts', 'assets', 'public', 'static', 'images', 'img', 'media',
  'dist', 'build', 'lib', 'out', 'coverage', 'bin', 'website', 'site',
  'target', 'vendor', 'types', '.git',
])

/** Repositories that are the ecosystem itself, never a plugin to install. */
export const UPSTREAM_REPOS = new Set([
  'deepseek-ai/deepseek-harness',
])

/** Single-choice category enum handed to the labelling model. */
export const CATEGORIES = [
  'coding', 'browser-web', 'data-analysis', 'media-image', 'media-audio-video',
  'productivity', 'communication', 'devops-infra', 'search-knowledge',
  'ui-experience', 'agent-orchestration', 'security', 'other',
] as const

/**
 * Closed tag vocabulary.
 *
 * Deliberately fixed: letting the model invent tags produces a long tail of
 * near-duplicates that makes filtering useless. Adding a tag is a deliberate
 * act that bumps VOCAB_VERSION and re-labels everything.
 */
export const TAGS = [
  'has-web-ui', 'headless', 'cli-companion', 'slash-command', 'skills',
  'file-ops', 'shell', 'git', 'code-review', 'refactor', 'test-gen', 'debug',
  'browser-automation', 'web-search', 'web-scrape', 'rag', 'vector-db',
  'sql', 'spreadsheet', 'chart', 'ocr', 'tts', 'asr', 'image-gen', 'image-edit', 'video',
  'pdf', 'translate', 'summarize', 'notes', 'todo', 'calendar', 'email', 'im-bot',
  'docker', 'k8s', 'ci-cd', 'cloud', 'monitoring', 'logging', 'ssh',
  'multi-agent', 'subagent', 'memory', 'planner', 'prompt-engineering', 'model-router',
  'mcp-bridge', 'plugin-manager', 'theme', 'i18n', 'accessibility',
  'needs-api-key', 'needs-local-service', 'needs-browser', 'experimental',
] as const

/** Bumped when the prompt changes; invalidates every cached label. */
export const PROMPT_VERSION = 'p7'

/** Bumped when CATEGORIES or TAGS change; invalidates every cached label. */
export const VOCAB_VERSION = 'v1'

/**
 * Labelling model.
 *
 * Served through the Anthropic-compatible endpoint below, which also accepts
 * Claude model names and maps them (`claude-opus-5` resolves to
 * `deepseek-v4-pro`). Labelling is bulk classification, so the flash tier is
 * both sufficient and the right cost point; name it explicitly rather than
 * relying on the alias mapping.
 */
export const LLM_MODEL = process.env.LLM_MODEL ?? 'deepseek-v4-flash'

/**
 * Base URL for the Anthropic SDK.
 *
 * Measured: this project's key returns 403 on api.anthropic.com and 200 on
 * DeepSeek's Anthropic-compatible endpoint. Override with `LLM_BASE_URL` — a
 * genuine `sk-ant-…` key wants `https://api.anthropic.com`.
 */
export const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/anthropic'

/**
 * Ceiling on labelling calls per incremental run.
 *
 * This is the guard against an accidental full re-label: a cache-key change
 * (a prompt edit, a vocabulary bump) invalidates every entry at once, and
 * without this the next scheduled run would quietly spend the full-rebuild
 * budget. Exceeding it aborts with an explanation instead.
 */
export const MAX_LLM_CALLS = 300

/** Concurrency for labelling requests. */
export const LLM_CONCURRENCY = 8

/** Catalog schema version emitted by this build. */
export const SCHEMA_VERSION = 1

/** Published data directory, relative to the repository root. */
export const DATA_DIR = 'data/v1'
