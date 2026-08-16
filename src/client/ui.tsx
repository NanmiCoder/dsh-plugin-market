/**
 * Shared presentational primitives.
 *
 * Icons are inline SVG rather than an icon package: this bundle ships with no
 * runtime dependencies and loads inside the DSH shell, where a webfont request
 * would be a second network round trip for decoration. Glyphs are Lucide
 * paths on a 24-unit grid at stroke-width 2.75 — the rounder, heavier weight
 * the market design language calls for.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Tier } from '../types.ts'
import type { PluginHubLocaleKey } from './locales.ts'
import css from './ui.module.css'

/** Tier to locale key. */
export const TIER_KEYS = {
  'verified-npm': 'tierVerifiedNpm',
  'verified-git': 'tierVerifiedGit',
  'likely-plugin': 'tierLikely',
  related: 'tierRelated',
} satisfies Record<Tier, PluginHubLocaleKey>

/** Closed-vocabulary tags the UI speaks natively; anything else falls back to the raw tag. */
const TAG_KEYS = {
  'has-web-ui': 'badgeWebUi',
  skills: 'badgeSkills',
  'needs-api-key': 'badgeApiKey',
  memory: 'capMemory',
  'multi-agent': 'capMultiAgent',
  'web-search': 'capWebSearch',
  'mcp-bridge': 'capMcpBridge',
  'cli-companion': 'capCliCompanion',
  ocr: 'capOcr',
  'file-ops': 'capFileOps',
} satisfies Record<string, PluginHubLocaleKey>

/** Category to locale key, covering the crawler's whole category vocabulary. */
const CATEGORY_KEYS = {
  coding: 'catCoding',
  'browser-web': 'catBrowserWeb',
  'data-analysis': 'catDataAnalysis',
  'media-image': 'catMediaImage',
  'media-audio-video': 'catMediaAudioVideo',
  productivity: 'catProductivity',
  communication: 'catCommunication',
  'devops-infra': 'catDevopsInfra',
  'search-knowledge': 'catSearchKnowledge',
  'ui-experience': 'catUiExperience',
  'agent-orchestration': 'catAgentOrchestration',
  security: 'catSecurity',
  other: 'catOther',
} satisfies Record<string, PluginHubLocaleKey>

type Translate = (key: PluginHubLocaleKey) => string

/**
 * Translate a capability tag from the closed vocabulary.
 * @param t - the bound translation function.
 * @param tag - the raw tag.
 * @returns the localized label, or the tag itself when unknown.
 */
export function tagLabel(t: Translate, tag: string): string {
  const key = TAG_KEYS[tag as keyof typeof TAG_KEYS] as PluginHubLocaleKey | undefined
  return key === undefined ? tag : t(key)
}

/**
 * Translate a category from the closed vocabulary.
 * @param t - the bound translation function.
 * @param category - the raw category.
 * @returns the localized label, or the category itself when unknown.
 */
export function categoryLabel(t: Translate, category: string): string {
  const key = CATEGORY_KEYS[category as keyof typeof CATEGORY_KEYS] as PluginHubLocaleKey | undefined
  return key === undefined ? category : t(key)
}

/** The icons this UI draws. */
export type IconName =
  | 'star' | 'close' | 'external' | 'search' | 'refresh' | 'back' | 'down'
  | 'empty' | 'copy' | 'check' | 'shield' | 'file' | 'info'

/** Lucide path data, drawn on a 24-unit grid. */
const GLYPHS: Record<IconName, ReactNode> = {
  star: <path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9z" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  back: <path d="m15 18-6-6 6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  empty: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  copy: (
    <>
      <path d="M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  shield: (
    <>
      <path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </>
  ),
}

/** Icons drawn with a solid fill rather than a stroke. */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['star'])

/** Props for {@link Icon}. */
export interface IconProps {
  readonly name: IconName
  /** Rendered size in pixels; defaults to the surrounding text size. */
  readonly size?: number
}

/**
 * Draw one icon.
 * @param props - the icon name and size.
 * @returns the SVG element.
 */
export function Icon(props: IconProps): React.ReactElement {
  const { name, size } = props
  const filled = FILLED.has(name)
  return (
    <svg
      className={css.icon}
      width={size ?? '1em'}
      height={size ?? '1em'}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g fill={filled ? 'currentColor' : 'none'}>{GLYPHS[name]}</g>
    </svg>
  )
}

/** Props for {@link CopyButton}. */
export interface CopyButtonProps {
  /** The text placed on the clipboard. */
  readonly text: string
  readonly label: string
  readonly copiedLabel: string
}

/**
 * Copy-to-clipboard button for terminal surfaces.
 *
 * The feedback is the icon and label swapping to a check for a moment: a
 * toast would be a second notification system for a one-word message. When
 * the Clipboard API is unavailable (insecure context) the click is a no-op.
 * @param props - the text and its labels.
 * @returns the button.
 */
export function CopyButton(props: CopyButtonProps): React.ReactElement {
  const { text, label, copiedLabel } = props
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const copy = (): void => {
    if (navigator.clipboard === undefined) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setCopied(false) }, 1600)
    })
  }
  return (
    <button
      type="button"
      className={css.copyButton}
      data-copied={copied ? '' : undefined}
      onClick={copy}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      <span>{copied ? copiedLabel : label}</span>
    </button>
  )
}

/** Props for {@link Terminal}. */
export interface TerminalProps {
  /** The command text, rendered verbatim and copied by the copy button. */
  readonly command: string
  readonly copyLabel: string
  readonly copiedLabel: string
  /** Extra layout class from the caller's own module (margins and the like). */
  readonly className?: string
}

/**
 * A dark terminal surface for commands, in both themes.
 *
 * The copy button rides the top-right corner: "a command you run" stays one
 * click away without a separate head bar eating vertical space. The body is a
 * `<pre>`, so multi-line manual steps keep their line breaks.
 * @param props - the command and its copy labels.
 * @returns the terminal block.
 */
export function Terminal(props: TerminalProps): React.ReactElement {
  const { command, copyLabel, copiedLabel, className } = props
  return (
    <div className={className === undefined ? css.terminal : `${css.terminal} ${className}`}>
      <pre className={css.terminalBody}>{command}</pre>
      <CopyButton text={command} label={copyLabel} copiedLabel={copiedLabel} />
    </div>
  )
}

/** Props for {@link Metric}. */
export interface MetricProps {
  readonly label: string
  readonly value: string | number
}

/**
 * One label-over-value pair in the metrics grid.
 * @param props - the label and value.
 * @returns the metric cell.
 */
export function Metric(props: MetricProps): React.ReactElement {
  const { label, value } = props
  return (
    <div className={css.metric}>
      <dt className={css.metricLabel}>{label}</dt>
      <dd className={css.metricValue}>{typeof value === 'number' ? compact(value) : value}</dd>
    </div>
  )
}

/**
 * Shorten a large count so columns stay aligned.
 * @param value - the raw count.
 * @returns a display string.
 */
export function compact(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

/**
 * Format an ISO timestamp as a short local date.
 * @param iso - the timestamp.
 * @returns a date string, or an em dash when unparsable.
 */
export function shortDate(iso: string): string {
  const value = Date.parse(iso)
  if (Number.isNaN(value)) return '—'
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Describe how long ago a timestamp was, in coarse buckets.
 *
 * Freshness is the point, not precision: "3 months ago" tells you whether a
 * plugin is maintained, and an exact date does not.
 * @param iso - the timestamp.
 * @param t - the bound translation function.
 * @returns a relative description.
 */
export function relativeAge(iso: string, t: (key: PluginHubLocaleKey) => string): string {
  const value = Date.parse(iso)
  if (Number.isNaN(value)) return '—'
  const days = Math.floor((Date.now() - value) / 86_400_000)
  if (days <= 1) return t('ageToday')
  if (days < 30) return `${days}${t('ageDays')}`
  if (days < 365) return `${Math.floor(days / 30)}${t('ageMonths')}`
  return `${Math.floor(days / 365)}${t('ageYears')}`
}
