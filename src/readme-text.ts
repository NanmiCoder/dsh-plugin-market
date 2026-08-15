/**
 * Making README text safe and readable before it is rendered.
 *
 * Two jobs: deciding which URLs may reach the DOM, and reducing the HTML that
 * READMEs are full of down to Markdown the renderer understands.
 *
 * This lives outside `src/client` on purpose. It is compiled into both tsc
 * programs — the browser half imports it, and the host build emits it to
 * `lib/` — which is what lets the offline smoke checks exercise it directly.
 * A security boundary that cannot be tested is a security boundary nobody
 * knows the state of.
 *
 * Like `types.ts`, it must stay import-free so neither program drags the
 * other's `Context` declaration merge in behind it.
 */

/** The only schemes a rendered link or image may use. */
const SAFE_SCHEME = /^https?:\/\//i

/**
 * Inline Markdown constructs, matched in priority order within one pass.
 *
 * Order is load-bearing. The linked-image alternative must come before the
 * plain link: nearly every README opens with a row of badges written as
 * `[![alt](image)](target)`, and the plain-link pattern matches a prefix of
 * that — taking `![alt` as the label and the image URL as the destination —
 * which leaves `](target)` stranded as literal text in the output.
 *
 * Lives here rather than beside the renderer so the ordering can be asserted
 * without standing up React.
 */
export const INLINE = new RegExp([
  '(`[^`\\n]+`)',
  '(\\[!\\[[^\\]]*\\]\\([^)\\s]+(?:\\s+"[^"]*")?\\)\\]\\([^)\\s]+(?:\\s+"[^"]*")?\\))',
  '(!\\[[^\\]]*\\]\\([^)\\s]+(?:\\s+"[^"]*")?\\))',
  '(\\[[^\\]]*\\]\\([^)\\s]+(?:\\s+"[^"]*")?\\))',
  '(\\*\\*[^*\\n]+\\*\\*)',
  '(__[^_\\n]+__)',
  '(\\*[^*\\n]+\\*)',
  '(~~[^~\\n]+~~)',
  '(<https?://[^>\\s]+>)',
].join('|'))

/**
 * Resolve a possibly-relative URL, refusing anything that is not http(s).
 *
 * React escapes text content but does not vet URL attributes: it will pass
 * `javascript:alert(1)` to an `href` unchanged. README text comes from
 * strangers' repositories, so every URL is filtered here before it reaches
 * the DOM. Schemes are checked after resolution as well as before, because a
 * relative-looking string can still resolve somewhere unexpected.
 * @param raw - the URL as written in the document.
 * @param baseUrl - the document's own location, when known.
 * @returns an absolute http(s) URL, or undefined when unusable.
 */
export function safeUrl(raw: string, baseUrl?: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (SAFE_SCHEME.test(trimmed)) return trimmed
  // A scheme this side does not allow must never fall through to relative
  // resolution, where a permissive base could revive it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined
  // Anchors point inside a document that is not this page; there is nothing
  // to scroll to, so they are dropped rather than rendered as dead links.
  if (trimmed.startsWith('#')) return undefined
  if (baseUrl === undefined) return undefined
  try {
    const resolved = new URL(trimmed, baseUrl)
    return SAFE_SCHEME.test(resolved.href) ? resolved.href : undefined
  } catch {
    return undefined
  }
}

/** The handful of named entities that actually turn up in READMEs. */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
}

/**
 * Decode HTML character references.
 * @param text - text possibly containing entities.
 * @returns the decoded text.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      // Reject non-characters and anything outside the Unicode range rather
      // than letting String.fromCodePoint throw mid-render.
      if (!Number.isInteger(code) || code < 32 || code > 0x10FFFF) return whole
      return String.fromCodePoint(code)
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * Reduce the HTML in a README to Markdown.
 *
 * READMEs routinely open with a centred `<p><img></p>` banner and an `<h1>`,
 * because GitHub renders HTML and Markdown together. This renderer never emits
 * HTML — that is what makes it injection-proof — so without this pass those
 * tags would be displayed as literal text, which is safe but unreadable.
 *
 * Only tags with a Markdown equivalent are converted; every other tag is
 * dropped and its text content kept. Nothing here produces markup: the output
 * is Markdown source that still goes through the normal renderer, so no
 * attribute an author writes can reach the DOM by this route.
 * @param source - the raw README.
 * @returns Markdown with the HTML folded in.
 */
export function htmlToMarkdown(source: string): string {
  // A fenced block showing HTML as an example must survive intact, so the
  // conversion is applied only between fences.
  return source
    .split(/(^[ \t]*(?:```|~~~)[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$)/m)
    .map(part => (/^[ \t]*(?:```|~~~)/.test(part) ? part : convertOutsideFences(part)))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Apply the HTML conversion to one non-fenced span.
 * @param source - a span of README text containing no code fence.
 * @returns the span with HTML folded into Markdown.
 */
function convertOutsideFences(source: string): string {
  let text = source
    // Comments first: they can wrap anything, including other tags.
    .replace(/<!--[\s\S]*?-->/g, '')
    // Script and style content is never displayable text.
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|table|tr)>/gi, '\n\n')

  // Images and links carry a URL worth keeping, so they become Markdown
  // rather than being flattened to their text.
  text = text.replace(
    /<img\b[^>]*?\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi,
    (whole, src: string) => {
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(whole)?.[1] ?? ''
      return `![${alt}](${src})`
    },
  )
  text = text.replace(
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_whole, href: string, label: string) => `[${label.replace(/<[^>]*>/g, '').trim()}](${href})`,
  )

  text = text
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_whole, level: string, body: string) => `\n\n${'#'.repeat(Number(level))} ${body.replace(/<[^>]*>/g, '').trim()}\n\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_w, _t, body: string) => `**${body.replace(/<[^>]*>/g, '')}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_w, _t, body: string) => `*${body.replace(/<[^>]*>/g, '')}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_w, body: string) => `\`${body.replace(/<[^>]*>/g, '')}\``)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    // Everything left is layout: drop the tag, keep the words.
    .replace(/<\/?[a-z][^>]*>/gi, '')

  return decodeEntities(text)
}
