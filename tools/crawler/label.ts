/**
 * Model labelling, through the official Anthropic SDK.
 *
 * **Transport.** The SDK talks to whatever `baseURL` it is given. The key this
 * project uses authenticates against DeepSeek's Anthropic-compatible endpoint,
 * not api.anthropic.com — measured: the same key returns 403 on
 * `api.anthropic.com/v1/messages` and 200 on
 * `api.deepseek.com/anthropic/v1/messages`. So the client is the real Anthropic
 * SDK (its types, retries, and typed errors) pointed at that endpoint. Set
 * `LLM_BASE_URL` to move it; an actual `sk-ant-…` key needs no override.
 *
 * **Structured output via tool use.** The Messages API guarantees a shape by
 * forcing a tool call, not by asking for JSON in prose. Two things were
 * measured on this endpoint and drive the request below:
 *
 *   - `output_config.format` (structured outputs) is accepted with a 200 but is
 *     **not enforced** — a request pinning `{category}` came back with entirely
 *     different keys. It cannot be relied on here.
 *   - A forced `tool_choice` is rejected while thinking is on
 *     ("Thinking mode does not support this tool_choice"), so thinking is
 *     disabled explicitly. Labelling is classification, not reasoning, and the
 *     saved thinking tokens are the bulk of the cost.
 *
 * **Cost.** The cache key deliberately excludes `pushedAt`: a repository that
 * commits fifty times without touching its README or manifest costs nothing to
 * re-label, because nothing the model reads has changed.
 */

import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import {
  CATEGORIES, LLM_BASE_URL, LLM_CONCURRENCY, LLM_MODEL,
  MAX_LLM_CALLS, PROMPT_VERSION, TAGS, VOCAB_VERSION,
} from './config.ts'
import { mapLimit } from './enrich.ts'
import type { CachedLabel, Candidate, Label } from './types.ts'

/** Raised when an incremental run would label more entries than the cap allows. */
export class BudgetExceeded extends Error {}

/** The tool the model is forced to call. Its schema IS the output contract. */
const LABEL_TOOL: Anthropic.Tool = {
  name: 'emit_label',
  description: 'Record the classification of one DeepSeek Harness plugin.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...CATEGORIES],
        description: 'The single best category — the BROAD area, from this list only. Names like "plugin-manager" or "code-review" are tags, not categories: never emit them here. Use "other" only when nothing else fits.',
      },
      tags: {
        type: 'array',
        items: { type: 'string', enum: [...TAGS] },
        maxItems: 6,
        description: 'At most 6 tags from the list — specific capabilities. Names like "security" or "ui-experience" are categories, not tags: never emit them here. Prefer 2-4 precise tags over 6 loose ones.',
      },
      summaryZh: {
        type: 'string',
        description: 'One sentence in Simplified Chinese, 8-40 characters, no trailing period. State what the plugin DOES for a user.',
      },
      summaryEn: {
        type: 'string',
        description: 'One sentence in English, 12-120 characters. State what the plugin DOES for a user.',
      },
      needsApiKey: {
        type: 'boolean',
        description: 'True when the user must supply a third-party credential to use it.',
      },
      isSpam: {
        type: 'boolean',
        description: 'True for name-squatting, empty shells, or bulk-generated filler. Judge from evidence: a one-file package with no README claiming a big feature is spam; a small but honest plugin is not.',
      },
      relevance: {
        type: 'string',
        enum: ['plugin', 'adjacent', 'unrelated'],
        description: 'Whether this repo genuinely belongs to the DeepSeek Harness (DSH) ecosystem. Judge ONLY from the manifest and README — GitHub topics are free to add and are routinely abused for exposure, so a topic alone is evidence of nothing. "plugin": built as a DSH plugin (declares dsh.bundle with a cordis.patch.yml, or depends on the @deepseek-ai/* runtime with an entry point, or its README documents installing into DSH as a plugin). "adjacent": not a plugin, but built PRIMARILY for DSH users — a DSH skills pack, theme, or companion tool that would barely exist without DSH. "unrelated": everything else — in particular any general-purpose tool, agent, skill, or app that supports DSH as ONE of several runtimes or hosts (Claude Code, Codex, OpenClaw, etc.): for those, supporting DSH is a feature, not their purpose. When in doubt between adjacent and unrelated, choose unrelated.',
      },
      confidence: {
        type: 'number',
        description: 'Between 0 and 1. When the input is thin, lower this rather than inventing detail.',
      },
      installMethod: {
        type: 'string',
        enum: ['npm', 'git', 'manual'],
        description: 'How the README says to install it. "npm" when the README documents installing a package (an npm add command, or a dsh plugin add of an npm spec); "git" when it is cloned and built from source; "manual" when there is no installable artifact at all.',
      },
      installCommand: {
        type: 'string',
        description: 'The exact install command the README gives, verbatim. REQUIRED when installMethod is "npm" or "git" — copy the command line exactly, e.g. "dsh plugin --profile web add @scope/pkg" or "npm i @foo/bar". When the README documents several install paths, report the one it recommends (typically the npm / dsh plugin add path, not the clone-and-build development path). Empty string only when the README documents no install command at all.',
      },
    },
    required: ['category', 'tags', 'summaryZh', 'summaryEn', 'needsApiKey', 'isSpam', 'relevance', 'confidence', 'installMethod', 'installCommand'],
  },
}

/**
 * System prompt. Kept byte-identical across requests so the endpoint's prefix
 * cache can serve it; nothing per-candidate is interpolated here.
 */
const SYSTEM_PROMPT = `You classify plugins for the DeepSeek Harness (DSH) plugin marketplace.

Call the emit_label tool exactly once with your classification. Do not write prose.

Judge only from the evidence given. A plugin's README and install excerpt describe
what it claims to do; the manifest and registry facts describe what was verified.
When the two disagree, weigh the verified facts more heavily.

Categories and tags are DIFFERENT vocabularies: a category is the broad area the
plugin belongs to (one of 13), a tag is a specific capability it has (up to 6).
Some names exist in only one of the two lists — "plugin-manager" is a tag, never
a category; "security" and "ui-experience" are categories, never tags. Check
which list a name belongs to before using it; if none fits, use category "other"
and fewer tags rather than inventing a value.

What a real DSH plugin looks like: its package.json declares a \`dsh.bundle.patch\`
pointing at a cordis.patch.yml patch list, or it depends on the @deepseek-ai/* runtime
and exposes an entry point; its README tells users to install it with \`dsh plugin add\`
or an equivalent. Some ecosystem projects are not plugins but exist primarily for DSH
users — DSH-only companion CLIs, skills packs, themes.

Beware exposure farming: repositories add DSH discovery topics so the marketplace
crawls them, while their content is a generic agent tool, skill, prompt pack, or
resource list. A topic or a passing mention of DSH is never enough. The most common
disguise is the multi-host tool: an app or skill that lists DSH as one of several
supported runtimes (alongside Claude Code, Codex, OpenClaw, and friends). Supporting
DSH is a feature of those tools, not their purpose — mark them relevance "unrelated".
Reserve "adjacent" for projects whose primary audience is DSH users.

For installMethod and installCommand, read the README's own installation section and
report what the author wrote — a package name, a git URL, or nothing. Do not infer an
install path from the manifest; the point is to capture the author's own instruction,
which the host will verify separately before anything is executed.`

/** Construct the client once — it holds a connection pool and retry state. */
let client: Anthropic | undefined

/**
 * Get (or lazily build) the Anthropic client.
 * @param apiKey - the API key to authenticate with.
 * @returns the shared client.
 */
function getClient(apiKey: string): Anthropic {
  client ??= new Anthropic({
    apiKey,
    baseURL: LLM_BASE_URL,
    // The SDK retries 408/409/429/5xx with exponential backoff on its own;
    // this replaces the hand-rolled retry loop the previous implementation had.
    maxRetries: 4,
    timeout: 60_000,
  })
  return client
}

/**
 * Compute the cache key for a candidate.
 *
 * Includes everything the model actually reads, plus the prompt and vocabulary
 * versions so a policy change invalidates cleanly.
 * @param candidate - the candidate.
 * @returns a short stable key.
 */
export function cacheKey(candidate: Candidate): string {
  const manifest = candidate.manifest
  const digest = JSON.stringify({
    dsh: manifest?.dsh ?? null,
    client: manifest?.dshClient ?? null,
    bin: manifest?.bin ?? null,
    peers: Object.keys(manifest?.peerDependencies ?? {}).sort(),
    deps: Object.keys(manifest?.dependencies ?? {}).sort(),
  })
  return createHash('sha256').update([
    PROMPT_VERSION,
    VOCAB_VERSION,
    LLM_MODEL,
    candidateId(candidate),
    candidate.readme?.sha ?? '',
    digest,
    candidate.repo.description ?? '',
    candidate.repo.repositoryTopics.nodes.map(node => node.topic.name).sort().join(','),
  ].join(' ')).digest('hex').slice(0, 20)
}

/**
 * Stable id for a candidate.
 * @param candidate - the candidate.
 * @returns the id used across the pipeline and the published catalog.
 */
export function candidateId(candidate: Candidate): string {
  const base = candidate.repo.nameWithOwner.toLowerCase()
  return candidate.subdir === undefined ? base : `${base}:${candidate.subdir}`
}

/**
 * Strip characters that cannot survive JSON transport.
 *
 * READMEs are arbitrary bytes from strangers' repositories. A lone surrogate —
 * half of an emoji pair, usually from a truncated fetch, and this pipeline
 * truncates every README at 32 KB — serializes into an escape the endpoint
 * rejects outright: `400 … unexpected end of hex escape`. That fails the whole
 * request, so the entry degrades over a single stray byte. Unpaired surrogates
 * and C0 control characters are therefore removed before the text is ever put
 * in a message.
 * @param text - untrusted text bound for the API.
 * @returns text safe to serialize.
 */
export function sanitizeForTransport(text: string): string {
  return text
    // Surrogates not part of a valid pair, in either direction.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // C0 controls except tab/newline/carriage return.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/**
 * Trim a README down to what is worth paying for.
 *
 * READMEs average ~25 KB; badges, image links and long tables carry almost no
 * classification signal. Keep the head (what it is) and the tail (configuration
 * and caveats), drop the middle (usually API listings).
 * @param raw - the README head as fetched.
 * @returns the trimmed text.
 */
export function clipReadme(raw: string): string {
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '[badge]')
    .replace(/!\[[^\]]*\]\([^)]{0,300}\)/g, '[img]')
    .replace(/```[\s\S]{600,}?```/g, match => `${match.slice(0, 300)}\n…\n\`\`\``)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length <= 4000) return cleaned
  return `${cleaned.slice(0, 2800)}\n\n…[middle omitted]…\n\n${cleaned.slice(-1200)}`
}

/**
 * Carve the install section out of a README, wherever it sits.
 *
 * Install instructions are the single most extraction-critical part of a
 * README, and they have no fixed address: heavy HTML preambles push them past
 * both the old 8 KB fetch window and clipReadme's head-plus-tail window, which
 * is how well-documented plugins ended up labelled "manual". Rather than
 * hoping the section survives the clip, extract it by heading — the first
 * heading mentioning install/setup/安装-style wording, plus a generous window
 * after it — and hand it to the model as its own prompt block.
 * @param raw - the README as fetched.
 * @returns the excerpt, or undefined when no install heading exists.
 */
export function extractInstallExcerpt(raw: string): string | undefined {
  const heading = /^ {0,3}#{1,6}\s[^\n]*(install|installation|setup|getting started|quick ?start|安装|上手|部署|快速开始|快速上手)[^\n]*$/im.exec(raw)
  if (heading === null) return undefined
  return raw.slice(heading.index, heading.index + 1600).trim()
}

/**
 * Build the per-candidate user message.
 * @param candidate - the candidate.
 * @returns the message text.
 */
function buildPrompt(candidate: Candidate): string {
  const repo = candidate.repo
  const manifest = candidate.manifest
  const body = [
    '## PLUGIN',
    `repo: ${repo.nameWithOwner}${candidate.subdir === undefined ? '' : ` (subdir: ${candidate.subdir})`}`,
    `npm: ${candidate.npm?.name ?? 'unpublished'}`,
    `description: ${repo.description ?? '(none)'}`,
    `topics: ${repo.repositoryTopics.nodes.map(node => node.topic.name).join(', ') || '(none)'}`,
    `stars: ${repo.stargazerCount}  updated: ${repo.pushedAt.slice(0, 10)}`,
    '',
    '## MANIFEST',
    `dsh.bundle: ${manifest?.dsh?.bundle?.patch ?? '(absent)'}`,
    `browser half: ${manifest?.dsh?.client !== undefined || manifest?.dshClient !== undefined ? 'yes' : 'no'}`,
    `@deepseek-ai runtime dependency: ${Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies }).some(name => name.startsWith('@deepseek-ai/')) ? 'yes' : 'no'}`,
    `dependencies: ${Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies }).slice(0, 20).join(', ') || '(none)'}`,
    '',
    '## NPM REGISTRY (what an install would place on disk)',
    candidate.npm === undefined
      ? 'unpublished, or the registry lookup failed'
      : `published as ${candidate.npm.name}@${candidate.npm.version}; declares dsh.bundle: ${candidate.npm.hasDshBundle ? 'yes' : 'no'}; browser half: ${candidate.npm.hasClient ? 'yes' : 'no'}`,
    '',
    '## README — INSTALL SECTION (verbatim excerpt, trust it for installMethod/installCommand)',
    candidate.readme === undefined ? '(no README found)' : (extractInstallExcerpt(candidate.readme.text) ?? '(no install heading found)'),
    '',
    '## README',
    candidate.readme === undefined ? '(no README found)' : clipReadme(candidate.readme.text),
  ].join('\n')
  // One choke point: every byte that reaches the API passes through here.
  return sanitizeForTransport(body)
}

/**
 * Validate a tool call's input against the declared contract.
 *
 * The schema is sent to the model, but the model is not bound by it — enum
 * drift and missing fields both happen. This is the enforcement point.
 *
 * Severity is deliberately split by what the field is worth. Only the summaries
 * are load-bearing — without them there is no classification to publish, so a
 * missing one degrades the entry. Everything else has a safe default and is
 * reported as drift instead:
 *
 *   - An out-of-enum category becomes `other`. A miscategorised entry is
 *     strictly better than a degraded one, and the model reaches outside the
 *     enum often enough at scale (18 of the first few hundred) that failing on
 *     it would throw away good summaries wholesale.
 *   - An invented tag is dropped. Tags are a secondary filter; discarding a
 *     whole good classification over one hallucinated tag loses far more than
 *     it protects.
 *
 * The closed vocabulary still holds either way — nothing invented ever reaches
 * the catalog. The drift is logged, because a value the model keeps reaching
 * for is the strongest signal for what the next vocabulary should contain.
 * @param value - the tool call input.
 * @returns the label plus whatever drifted, or a list of problems.
 */
export function validateLabel(
  value: unknown,
): { label: Label, droppedTags: string[], droppedCategory?: string } | { errors: string[] } {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null) return { errors: ['reply is not an object'] }
  const row = value as Record<string, unknown>
  const offeredCategory = typeof row.category === 'string' ? row.category : ''
  const categoryOk = (CATEGORIES as readonly string[]).includes(offeredCategory)
  let category = categoryOk ? offeredCategory : 'other'
  const offered = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  const tags: string[] = []
  const droppedTags: string[] = []
  // Cross-slot recovery before any dropping: the model systematically confuses
  // the two vocabularies (measured: "plugin-manager" emitted as a category 155
  // times in one sweep, "security" as a tag 184 times). Both values are ours —
  // moving one to its right slot recovers the signal that dropping would lose.
  for (const tag of offered) {
    if ((TAGS as readonly string[]).includes(tag)) {
      if (!tags.includes(tag)) tags.push(tag)
      continue
    }
    if ((CATEGORIES as readonly string[]).includes(tag) && category === 'other') {
      // A category value in the tag slot, with the category slot free: promote.
      category = tag
      continue
    }
    droppedTags.push(tag)
  }
  if (!categoryOk && (TAGS as readonly string[]).includes(offeredCategory)) {
    // A tag value in the category slot: demote it into the tag list.
    if (!tags.includes(offeredCategory)) tags.unshift(offeredCategory)
  }
  const droppedCategory = categoryOk || offeredCategory === '' || (TAGS as readonly string[]).includes(offeredCategory)
    ? undefined
    : offeredCategory
  const finalTags = tags.slice(0, 6)
  const summaryZh = typeof row.summaryZh === 'string' ? row.summaryZh.trim() : ''
  const summaryEn = typeof row.summaryEn === 'string' ? row.summaryEn.trim() : ''
  if (summaryZh === '') errors.push('summaryZh is required')
  if (summaryEn === '') errors.push('summaryEn is required')

  // installMethod and installCommand are hints, not verdicts: the host verifies
  // them against the npm registry or the repository before acting. A malformed
  // one degrades to "manual" rather than failing the entry.
  const offeredMethod = typeof row.installMethod === 'string' ? row.installMethod : ''
  const installMethod = (['npm', 'git', 'manual'] as const).includes(offeredMethod as never)
    ? offeredMethod as 'npm' | 'git' | 'manual'
    : 'manual'
  const installCommand = typeof row.installCommand === 'string' ? row.installCommand.trim() : ''

  if (errors.length > 0) return { errors }
  // relevance gates publication but is never load-bearing for the label itself:
  // an absent or invented verdict leaves the entry published, so a model that
  // reaches outside the enum cannot silently empty the catalog.
  const offeredRelevance = typeof row.relevance === 'string' ? row.relevance : ''
  const relevance = (['plugin', 'adjacent', 'unrelated'] as const).includes(offeredRelevance as never)
    ? offeredRelevance as 'plugin' | 'adjacent' | 'unrelated'
    : undefined
  return {
    droppedCategory,
    label: {
      category,
      tags: finalTags,
      summaryZh,
      summaryEn,
      needsApiKey: row.needsApiKey === true,
      isSpam: row.isSpam === true,
      relevance,
      confidence: typeof row.confidence === 'number' ? Math.max(0, Math.min(1, row.confidence)) : 0.5,
      installMethod,
      installCommand,
    },
    droppedTags,
  }
}

/** Options for {@link labelAll}. */
export interface LabelOptions {
  readonly apiKey: string
  readonly previous: Map<string, CachedLabel>
  readonly force: boolean
  readonly log: (line: string) => void
  /**
   * Optional incremental persistence: `write` is invoked with the labels
   * accumulated so far (cached + fresh + degraded) after every `every`
   * completions. A full re-label runs for tens of minutes and its results are
   * otherwise only persisted at emit, so a killed process would lose every
   * computed label. Checkpoints let the next run resume from the cache.
   */
  readonly checkpoint?: { readonly every: number, readonly write: (labels: Map<string, CachedLabel>) => void }
}

/** Outcome of a labelling pass. */
export interface LabelResult {
  readonly labels: Map<string, CachedLabel>
  readonly called: number
  readonly cached: number
  readonly failed: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/**
 * Label every candidate that needs it, reusing cached labels otherwise.
 * @param candidates - the candidates to label.
 * @param options - api key, cache, and logging.
 * @returns labels keyed by candidate id, plus counters.
 * @throws BudgetExceeded when more work is queued than the cap allows.
 */
export async function labelAll(
  candidates: readonly Candidate[], options: LabelOptions,
): Promise<LabelResult> {
  const labels = new Map<string, CachedLabel>()
  const todo: Candidate[] = []
  for (const candidate of candidates) {
    const id = candidateId(candidate)
    const cached = options.previous.get(id)
    if (cached !== undefined && cached.key === cacheKey(candidate)) {
      labels.set(id, cached)
      continue
    }
    todo.push(candidate)
  }

  if (!options.force && todo.length > MAX_LLM_CALLS) {
    throw new BudgetExceeded(
      `${todo.length} entries need labelling but the cap is ${MAX_LLM_CALLS}. `
      + 'This usually means a cache-key change (PROMPT_VERSION, VOCAB_VERSION, or the model) '
      + 'invalidated everything. Re-run with --force if that was intended.',
    )
  }

  options.log(`label: ${labels.size} cached, ${todo.length} to call (model ${LLM_MODEL})`)
  const anthropic = getClient(options.apiKey)
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  let completed = 0

  await mapLimit(todo, async (candidate) => {
    const outcome = await labelOne(anthropic, candidate, options.log)
    const id = candidateId(candidate)
    const key = cacheKey(candidate)
    if (outcome !== undefined) {
      inputTokens += outcome.inputTokens
      outputTokens += outcome.outputTokens
      labels.set(id, { ...outcome.label, key })
    } else {
      failed += 1
      // Degrade rather than drop: a previous label, else a rule-derived
      // placeholder, so a model outage never empties the catalog.
      const previous = options.previous.get(id)
      labels.set(id, previous !== undefined
        ? { ...previous, key, stale: true }
        : { ...fallbackLabel(candidate), key, stale: true })
    }
    completed += 1
    if (options.checkpoint !== undefined && completed % options.checkpoint.every === 0) {
      try {
        options.checkpoint.write(labels)
        options.log(`label: checkpoint at ${completed}/${todo.length}`)
      } catch {
        // A failed checkpoint must not void the run it protects.
      }
    }
  }, LLM_CONCURRENCY)

  return { labels, called: todo.length, cached: candidates.length - todo.length, failed, inputTokens, outputTokens }
}

/**
 * Label one candidate by forcing the tool call.
 * @param anthropic - the client.
 * @param candidate - the candidate.
 * @param log - progress sink.
 * @returns the label and its token usage, or undefined when the call failed.
 */
async function labelOne(
  anthropic: Anthropic, candidate: Candidate, log: (line: string) => void,
): Promise<{ label: Label, inputTokens: number, outputTokens: number } | undefined> {
  try {
    const message = await anthropic.messages.create({
      model: LLM_MODEL,
      max_tokens: 1024,
      // Classification, not creative writing: pin the temperature so the same
      // README yields the same verdict. Without this the endpoint default made
      // relevance judgements jitter run to run (open-design was judged
      // "unrelated" in one pass and "adjacent" in the next).
      temperature: 0,
      system: SYSTEM_PROMPT,
      // Forced tool choice is rejected while thinking is on, and classification
      // does not need reasoning — the thinking tokens would dominate the bill.
      thinking: { type: 'disabled' },
      tools: [LABEL_TOOL],
      tool_choice: { type: 'tool', name: LABEL_TOOL.name },
      messages: [{ role: 'user', content: buildPrompt(candidate) }],
    })
    const call = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    if (call === undefined) {
      log(`label: ${candidateId(candidate)} returned no tool call (stop_reason ${message.stop_reason})`)
      return undefined
    }
    const validated = validateLabel(call.input)
    if ('errors' in validated) {
      log(`label: ${candidateId(candidate)} produced an invalid label: ${validated.errors.join('; ')}`)
      return undefined
    }
    const drift = [
      ...validated.droppedTags.map(tag => `tag:${tag}`),
      ...(validated.droppedCategory === undefined ? [] : [`category:${validated.droppedCategory}`]),
    ]
    if (drift.length > 0) {
      // Vocabulary drift, not a failure. Worth seeing: a value the model keeps
      // reaching for is a candidate for the next VOCAB_VERSION.
      log(`label: drift on ${candidateId(candidate)}: ${drift.join(', ')}`)
    }
    return {
      label: validated.label,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    }
  } catch (error: unknown) {
    // The SDK has already retried transient failures; anything reaching here is
    // either terminal or exhausted, so degrade this one entry and continue.
    const detail = error instanceof Anthropic.APIError
      ? `${error.status ?? '?'} ${error.message}`
      : String(error)
    log(`label: ${candidateId(candidate)} failed: ${detail}`)
    return undefined
  }
}

/**
 * Build a rule-derived label for a candidate the model could not process.
 * @param candidate - the candidate.
 * @returns a low-confidence placeholder.
 */
function fallbackLabel(candidate: Candidate): Label {
  return {
    category: 'other',
    tags: [],
    summaryZh: candidate.repo.description ?? candidate.repo.nameWithOwner,
    summaryEn: candidate.repo.description ?? candidate.repo.nameWithOwner,
    needsApiKey: false,
    isSpam: false,
    confidence: 0.2,
    installMethod: 'manual',
    installCommand: '',
  }
}
