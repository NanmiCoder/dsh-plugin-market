/**
 * Ranking.
 *
 * The formula is published in README.md, and it is deliberately not
 * star-driven. Measured on this topic, star count is inversely related to
 * being a real plugin: the highest-starred results are large unrelated
 * projects that merely tagged themselves, while genuine plugins cluster in the
 * zero-and-single-digit tail. Stars therefore contribute at most 3 of ~110
 * points, and installability dominates.
 */

import type { CatalogEntry } from '../../src/types.ts'

/** Inputs the score needs beyond the published entry fields. */
export interface ScoreInput extends Omit<CatalogEntry, 'score'> {
  readonly readmeBytes: number
  readonly weeklyDownloads?: number
  readonly isSpam?: boolean
  readonly confidence?: number
  /** Index among sibling packages from the same monorepo. */
  readonly siblingRank?: number
}

/** A score with its component breakdown, so the UI can explain a ranking. */
export interface ScoreBreakdown {
  readonly total: number
  readonly parts: Record<string, number>
}

/**
 * Natural log of 1 + x.
 * @param value - the input.
 * @returns log1p, floored at 0.
 */
function ln1p(value: number): number {
  return Math.log1p(Math.max(0, value))
}

/**
 * Clamp a number into a range.
 * @param value - the input.
 * @param low - lower bound.
 * @param high - upper bound.
 * @returns the clamped value.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Score one entry.
 * @param entry - the entry and its scoring inputs.
 * @returns the total and its parts.
 */
export function score(entry: ScoreInput): ScoreBreakdown {
  const days = daysSince(entry.pushedAt)

  // Can it actually be installed? The largest single term, by design.
  const base = { 'verified-npm': 50, 'verified-git': 34, 'likely-plugin': 20, related: 8 }[entry.tier]

  // How certain is the install path.
  const install = { npm: 14, git: 7, manual: 2 }[entry.installMethod]

  // Recency, stepped rather than linear so a week-old plugin is not punished
  // like a year-old one.
  const fresh = days <= 3 ? 14 : days <= 7 ? 12 : days <= 14 ? 10
    : days <= 30 ? 7 : days <= 90 ? 4 : days <= 180 ? 2 : 0

  // Real adoption. Downloads outweigh stars 2:1 and stars cap at 3 points.
  const adoption = clamp(6 * ln1p(entry.weeklyDownloads ?? 0) / ln1p(5000), 0, 6)
    + clamp(3 * ln1p(entry.stars) / ln1p(300), 0, 3)
    + (entry.npmVersion !== undefined ? 3 : 0)

  // Is it finished enough for someone else to use.
  const complete = clamp(
    (entry.readmeBytes >= 800 ? 3 : 0) + (entry.readmeBytes >= 3000 ? 2 : 0)
    + (entry.license !== undefined ? 2 : 0)
    + (entry.description !== '' ? 1 : 0)
    + (entry.latestReleaseTag !== undefined ? 2 : 0),
    0, 10,
  )

  // Signs somebody is maintaining it.
  const closed = entry.closedIssues
  const maint = (closed >= 3 && closed / (closed + entry.openIssues) >= 0.5 ? 3 : 0)
    + (entry.commits >= 20 ? 3 : 0)
    + (entry.commits >= 3 && entry.forks >= 1 ? 2 : 0)

  const penalty = (entry.archived ? -25 : 0)
    + (entry.isFork && entry.tier !== 'verified-npm' ? -20 : 0)
    + (entry.isSpam === true ? -20 : 0)
    + (days > 365 ? -10 : 0)
    + (entry.license === undefined ? -4 : 0)
    // A six-package monorepo must not occupy the whole first page.
    + (entry.siblingRank !== undefined ? -3 * Math.min(entry.siblingRank, 4) : 0)

  const parts = { base, install, fresh, adoption, complete, maint, penalty }
  const raw = base + install + fresh + adoption + complete + maint + penalty
  // A low-confidence label nudges the score down; it never drives it.
  const total = clamp(Math.round(raw * ((entry.confidence ?? 0.5) < 0.5 ? 0.9 : 1)), 0, 100)
  return { total, parts }
}

/**
 * Whole days since an ISO timestamp.
 * @param iso - the timestamp.
 * @returns days elapsed, or a large number when unparsable.
 */
function daysSince(iso: string): number {
  const value = Date.parse(iso)
  if (Number.isNaN(value)) return 9999
  return (Date.now() - value) / 86_400_000
}
