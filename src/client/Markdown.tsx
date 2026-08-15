/**
 * A small Markdown renderer for README text.
 *
 * READMEs are arbitrary text written by strangers, so the one rule this module
 * exists to enforce is that it never produces raw HTML: every node is a React
 * element and every string goes through React's own escaping. There is no
 * `dangerouslySetInnerHTML` anywhere, which makes script injection impossible
 * by construction rather than by filtering. Any HTML a README contains is
 * shown as the text it is.
 *
 * It covers what READMEs actually use — headings, code, lists, quotes, links,
 * images, tables, emphasis — and deliberately not the long tail. An
 * unsupported construct degrades to readable text, never to a crash.
 */

import type { ReactElement, ReactNode } from 'react'
import { INLINE, htmlToMarkdown, safeUrl } from '../readme-text.ts'
import css from './Markdown.module.css'

/** Props for {@link Markdown}. */
export interface MarkdownProps {
  /** The raw Markdown source. */
  readonly source: string
  /** Absolute URL the source came from; relative links resolve against it. */
  readonly baseUrl?: string
}

/**
 * Split a `[label](target "title")` tail into its parts.
 * @param body - the text inside the parentheses.
 * @returns the target URL with any title stripped.
 */
function linkTarget(body: string): string {
  const space = body.indexOf(' ')
  return space === -1 ? body : body.slice(0, space)
}

/**
 * Render inline Markdown into React nodes.
 * @param text - one block's text.
 * @param baseUrl - the document's location, for relative links.
 * @param keyPrefix - key namespace, so sibling blocks cannot collide.
 * @returns the rendered children.
 */
function renderInline(text: string, baseUrl: string | undefined, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let index = 0
  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (match === null || match.index === undefined) {
      out.push(rest)
      break
    }
    if (match.index > 0) out.push(rest.slice(0, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${index}`
    index += 1
    if (token.startsWith('`')) {
      out.push(<code key={key} className={css.code}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[![')) {
      // A badge: an image wrapped in a link. Both URLs are vetted, and the
      // alt text stands in whenever the image URL is not usable.
      const inner = token.slice(1, token.lastIndexOf(']('))
      const label = inner.slice(2, inner.indexOf(']'))
      const image = safeUrl(linkTarget(inner.slice(inner.indexOf('](') + 2, -1)), baseUrl)
      const href = safeUrl(linkTarget(token.slice(token.lastIndexOf('](') + 2, -1)), baseUrl)
      const content = image === undefined
        ? label
        : <img className={css.badge} src={image} alt={label} loading="lazy" />
      out.push(href === undefined
        ? <span key={key}>{content}</span>
        : <a key={key} className={css.badgeLink} href={href} target="_blank" rel="noreferrer noopener">{content}</a>)
    } else if (token.startsWith('![')) {
      const label = token.slice(2, token.indexOf(']'))
      const href = safeUrl(linkTarget(token.slice(token.indexOf('](') + 2, -1)), baseUrl)
      // A README's images are mostly status badges. They are decorative and
      // often slow, so alt text stands in when the URL is unusable.
      out.push(href === undefined
        ? <span key={key}>{label}</span>
        : <img key={key} className={css.image} src={href} alt={label} loading="lazy" />)
    } else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'))
      const href = safeUrl(linkTarget(token.slice(token.indexOf('](') + 2, -1)), baseUrl)
      out.push(href === undefined
        ? <span key={key}>{label}</span>
        : <a key={key} className={css.link} href={href} target="_blank" rel="noreferrer noopener">{label}</a>)
    } else if (token.startsWith('<')) {
      const href = safeUrl(token.slice(1, -1), baseUrl)
      out.push(href === undefined
        ? <span key={key}>{token}</span>
        : <a key={key} className={css.link} href={href} target="_blank" rel="noreferrer noopener">{href}</a>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    rest = rest.slice(match.index + token.length)
  }
  return out
}

/**
 * Strip the pipes and padding from one table row.
 * @param line - the raw row.
 * @returns the trimmed cells.
 */
function tableCells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim())
}

/**
 * Render Markdown as React elements.
 *
 * Parsing is a single forward pass over lines: each iteration either consumes
 * a multi-line construct wholesale (fence, list, quote, table) or emits one
 * block. There is no backtracking, so malformed input ends the block it is in
 * rather than desynchronising the rest of the document.
 * @param props - the source and its base URL.
 * @returns the rendered document.
 */
export function Markdown(props: MarkdownProps): ReactElement {
  const { source, baseUrl } = props
  const lines = htmlToMarkdown(source.replace(/\r\n?/g, '\n')).split('\n')
  const blocks: ReactNode[] = []
  let cursor = 0
  let key = 0

  /** Consume lines while they satisfy a predicate. */
  const takeWhile = (predicate: (line: string) => boolean): string[] => {
    const taken: string[] = []
    while (cursor < lines.length && predicate(lines[cursor] as string)) {
      taken.push(lines[cursor] as string)
      cursor += 1
    }
    return taken
  }

  while (cursor < lines.length) {
    const line = lines[cursor] as string
    const id = `b${key}`
    key += 1

    if (line.trim() === '') { cursor += 1; key -= 1; continue }

    // Fenced code. An unterminated fence runs to the end of the document,
    // which is what every Markdown implementation does.
    const fence = /^\s*(```+|~~~+)(.*)$/.exec(line)
    if (fence !== null) {
      const marker = (fence[1] as string).slice(0, 3)
      cursor += 1
      const body = takeWhile(current => !current.trimStart().startsWith(marker))
      if (cursor < lines.length) cursor += 1
      blocks.push(
        <pre key={id} className={css.pre} data-lang={(fence[2] ?? '').trim() || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] as string).length
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2'
      cursor += 1
      blocks.push(
        <Tag key={id} className={css.heading} data-level={level}>
          {renderInline((heading[2] as string).replace(/\s*#+\s*$/, ''), baseUrl, id)}
        </Tag>,
      )
      continue
    }

    // Three or more of the same marker, optionally spaced: a thematic break.
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      cursor += 1
      blocks.push(<hr key={id} className={css.rule} />)
      continue
    }

    // Tables need a delimiter row directly under the header to be a table at
    // all; without one the pipes are just text.
    const next = lines[cursor + 1]
    if (line.includes('|') && next !== undefined && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next)) {
      const header = tableCells(line)
      cursor += 2
      const rows = takeWhile(current => current.includes('|') && current.trim() !== '').map(tableCells)
      blocks.push(
        <div key={id} className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>{header.map((cell, i) => <th key={i}>{renderInline(cell, baseUrl, `${id}h${i}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, baseUrl, `${id}${r}c${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s*>/.test(line)) {
      const body = takeWhile(current => /^\s*>/.test(current) || current.trim() !== '')
      blocks.push(
        <blockquote key={id} className={css.quote}>
          {renderInline(body.map(current => current.replace(/^\s*>\s?/, '')).join(' '), baseUrl, id)}
        </blockquote>,
      )
      continue
    }

    const bullet = /^\s*([-*+]|\d+[.)])\s+/
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (cursor < lines.length) {
        const current = lines[cursor] as string
        if (bullet.test(current)) {
          items.push(current.replace(bullet, ''))
          cursor += 1
        } else if (current.trim() !== '' && items.length > 0 && /^\s{2,}/.test(current)) {
          // A wrapped continuation line belongs to the item above it.
          items[items.length - 1] += ` ${current.trim()}`
          cursor += 1
        } else break
      }
      const children = items.map((item, i) => (
        <li key={i}>{renderInline(item, baseUrl, `${id}i${i}`)}</li>
      ))
      blocks.push(ordered
        ? <ol key={id} className={css.list}>{children}</ol>
        : <ul key={id} className={css.list}>{children}</ul>)
      continue
    }

    const paragraph = takeWhile(current => current.trim() !== ''
      && !bullet.test(current)
      && !/^\s*>/.test(current)
      && !/^(#{1,6})\s/.test(current)
      && !/^\s*(```|~~~)/.test(current))
    blocks.push(
      <p key={id} className={css.paragraph}>{renderInline(paragraph.join(' '), baseUrl, id)}</p>,
    )
  }

  return <div className={css.root}>{blocks}</div>
}
