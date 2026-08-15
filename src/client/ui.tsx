/**
 * Shared presentational primitives.
 *
 * Icons are inline SVG rather than an icon package: this bundle ships with no
 * runtime dependencies and loads inside the DSH shell, where a webfont request
 * would be a second network round trip for decoration. Stroke width is 1.5
 * throughout so glyphs sit at the same visual weight as the surrounding text.
 */

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

/** The icons this UI draws. */
export type IconName = 'star' | 'close' | 'external' | 'search' | 'refresh' | 'chevron' | 'empty'

/** Path data, drawn on a 16-unit grid. */
const PATHS: Record<IconName, string> = {
  star: 'M8 2.2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.2l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57z',
  close: 'M4 4l8 8M12 4l-8 8',
  external: 'M6.5 3.5h6v6M12.5 3.5L7 9M11 9.5v3h-8v-8h3',
  search: 'M7.2 11.4a4.2 4.2 0 100-8.4 4.2 4.2 0 000 8.4zM10.4 10.4l3 3',
  refresh: 'M13 8a5 5 0 11-1.6-3.7M13 2.6V5h-2.4',
  chevron: 'M6 3.5l4.5 4.5L6 12.5',
  empty: 'M2.5 5.5l5.5-3 5.5 3v5l-5.5 3-5.5-3zM2.5 5.5L8 8.5l5.5-3M8 8.5v5.5',
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
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name]}
        stroke={filled ? 'none' : 'currentColor'}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
