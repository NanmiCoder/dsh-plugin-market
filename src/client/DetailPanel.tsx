/**
 * The detail view for one catalog entry.
 *
 * The list answers "which plugin"; this answers "what is it, and do I trust
 * it". That means the evidence leads — what command will run, why the market
 * believes it is installable, what the author themselves wrote — and the
 * author's full README anchors the bottom of the scroll.
 */

import { useEffect, useState } from 'react'
import type { CatalogEntryView, ReadmeResponse } from '../types.ts'
import { fetchReadme } from './api.ts'
import type { PluginHubLocaleKey } from './locales.ts'
import { Markdown } from './Markdown.tsx'
import css from './DetailPanel.module.css'
import { Icon, Metric, TIER_KEYS, Terminal, categoryLabel, compact, shortDate, tagLabel } from './ui.tsx'

/** Translation function bound to this plugin's namespace. */
type Translate = (key: PluginHubLocaleKey) => string

/** README loading lifecycle. */
type ReadmeState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready', readonly data: ReadmeResponse }

/** Props for {@link DetailPanel}. */
export interface DetailPanelProps {
  readonly entry: CatalogEntryView
  readonly t: Translate
  readonly busy: boolean
  readonly installEnabled: boolean
  readonly onClose: () => void
  readonly onInstall: () => void
  readonly onUninstall: () => void
}

/**
 * Why the market believes the entry can (or cannot) be installed unattended.
 * @param entry - the catalog row.
 * @param t - the bound translation function.
 * @returns the evidence sentence.
 */
function evidence(entry: CatalogEntryView, t: Translate): string {
  if (entry.tier === 'verified-npm') return t('evidenceNpm')
  if (entry.tier === 'verified-git') return t('evidenceGit')
  return t('evidenceNone')
}

/** The right-hand detail panel. */
export function DetailPanel(props: DetailPanelProps): React.ReactElement {
  const { entry, t, busy, installEnabled, onClose, onInstall, onUninstall } = props
  const [readme, setReadme] = useState<ReadmeState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    setReadme({ status: 'loading' })
    void fetchReadme(entry.id).then((data) => {
      // The panel may have moved to another entry while this was in flight.
      if (live) setReadme({ status: 'ready', data })
    })
    return () => { live = false }
  }, [entry.id])

  const isInstalled = entry.installState !== 'not-installed'
  const manual = entry.installMethod === 'manual'
  const manualSteps = entry.manualSteps ?? [
    `git clone ${entry.url}.git`,
    `cd ${entry.repo.split('/')[1] ?? entry.repo}`,
    'pnpm install && pnpm build',
    'dsh plugin --profile web add $(pwd)',
  ]
  const installCommand = entry.installSpec === undefined ? undefined : `$ pnpm add ${entry.installSpec}`
  const chips = [
    ...(entry.category === undefined ? [] : [categoryLabel(t, entry.category)]),
    ...entry.tags.map(tag => tagLabel(t, tag)),
  ]

  return (
    <div className={css.panel} data-plugin-hub-detail={entry.id} aria-label={entry.repo}>
      {/* The detail view replaces the list, so going back has to be the most
          obvious thing in the header — not a bare close cross. */}
      <div className={css.topBar}>
        <button type="button" className={css.back} onClick={onClose}>
          <Icon name="back" size={13} />
          {t('backToList')}
        </button>
        <span className={css.tier} data-tier={entry.tier}>{t(TIER_KEYS[entry.tier])}</span>
      </div>

      <div className={css.body}>
        <div className={css.identity}>
          <h3 className={css.title}>{entry.packageName ?? entry.repo}</h3>
          <a className={css.repo} href={entry.url} target="_blank" rel="noreferrer noopener">
            {entry.repo}
            <Icon name="external" size={12} />
          </a>
        </div>

        {entry.description !== '' && <p className={css.description}>{entry.description}</p>}
        {entry.summary !== undefined && entry.summary !== '' && entry.summary !== entry.description && (
          <p className={css.descriptionMeta}>
            <span className={css.summaryTag}>{t('summaryLabel')}</span>
            {entry.summary}
          </p>
        )}

        {/* The install card leads: it is the panel's one action, and burying
            it below the metrics made the detail view read-only. */}
        <section className={css.installCard}>
          <h4 className={css.cardLabel}>{t('willRun')}</h4>
          {installCommand === undefined
            ? (
              <>
                <p className={css.note}>{t('manualBody')}</p>
                <Terminal
                  command={manualSteps.map(step => `$ ${step}`).join('\n')}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                />
              </>
            )
            : (
              <Terminal
                command={installCommand}
                copyLabel={t('copy')}
                copiedLabel={t('copied')}
              />
            )}
          <p className={css.evidence}>
            <Icon name="check" size={13} />
            {evidence(entry, t)}
          </p>
          {entry.runsBuildScript && <p className={css.warn}>{t('confirmBuild')}</p>}
        </section>

        {/* The author's own instruction, when there is one, named as separate
            from what will actually run — naming the gap is the whole point. */}
        {entry.installHint !== undefined && entry.installHint.command !== '' && (
          <section className={css.section}>
            <h4 className={css.sectionTitle}>{t('authorHint')}</h4>
            <div className={css.hint}>
              <code className={css.hintCommand}>{entry.installHint.command}</code>
              <span className={css.hintBadge}>{t('notExecuted')}</span>
            </div>
          </section>
        )}

        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('metricsTitle')}</h4>
          <dl className={css.metrics}>
            <Metric label={t('stars')} value={entry.stars} />
            <Metric label={t('forks')} value={entry.forks} />
            <Metric label={t('commits')} value={entry.commits} />
            <Metric label={t('openIssues')} value={entry.openIssues} />
            <Metric label={t('closedIssues')} value={entry.closedIssues} />
            <Metric label={t('openPrs')} value={entry.openPullRequests} />
            <Metric label={t('updated')} value={shortDate(entry.pushedAt)} />
            <Metric label={t('created')} value={shortDate(entry.createdAt)} />
            <Metric label={t('license')} value={entry.license ?? t('noLicense')} />
            <Metric label={t('language')} value={entry.language ?? '—'} />
            <Metric label={t('npmVersion')} value={entry.npmVersion ?? '—'} />
            <Metric label={t('latestRelease')} value={entry.latestReleaseTag ?? '—'} />
          </dl>
        </section>

        <section className={css.readmeSection}>
          <h4 className={css.readmeHead}>
            <Icon name="file" size={14} />
            <span className={css.readmeName}>{t('readmeTitle')}</span>
            {readme.status === 'ready' && readme.data.sourceUrl !== undefined && (
              <a
                className={css.readmeLink}
                href={`${entry.url}#readme`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('viewOnGithub')}
                <Icon name="external" size={11} />
              </a>
            )}
          </h4>
          {readme.status === 'loading' && <ReadmeSkeleton />}
          {readme.status === 'ready' && (readme.data.ok && readme.data.markdown.trim() !== ''
            ? <Markdown source={readme.data.markdown} baseUrl={readme.data.sourceUrl} />
            : (
              <p className={css.note}>
                {t('readmeUnavailable')}
                {' '}
                <a className={css.inlineLink} href={entry.url} target="_blank" rel="noreferrer noopener">
                  {t('viewRepo')}
                </a>
              </p>
            ))}
        </section>

        {chips.length > 0 && (
          <div className={css.chips}>
            {chips.map(chip => <span key={chip} className={css.chip}>{chip}</span>)}
          </div>
        )}
      </div>

      <footer className={css.foot}>
        <span className={css.stars}>
          {t('stars')} <b className={css.starsValue}>{compact(entry.stars)}</b>
        </span>
        {manual
          ? <span className={css.manualNote}>{t('manualOnly')}</span>
          : isInstalled
            ? (
              <button
                type="button"
                className={css.buttonGhost}
                disabled={busy || !installEnabled}
                onClick={onUninstall}
              >
                {busy ? t('uninstalling') : t('uninstall')}
              </button>
            )
            : (
              <button
                type="button"
                className={css.buttonPrimary}
                disabled={busy || !installEnabled}
                onClick={onInstall}
              >
                {busy ? t('installing') : t('install')}
              </button>
            )}
      </footer>
    </div>
  )
}

/**
 * Placeholder shaped like prose, shown while the README is in flight.
 *
 * A spinner would say "something is happening"; this says "text is coming and
 * roughly this much of it", which keeps the panel from jumping when it lands.
 * @returns the skeleton.
 */
function ReadmeSkeleton(): React.ReactElement {
  const widths = [92, 78, 86, 44, 88, 71, 90, 58]
  return (
    <div className={css.skeleton} aria-hidden="true">
      {widths.map((width, index) => (
        <span key={index} className={css.skeletonLine} style={{ width: `${width}%`, '--i': index } as React.CSSProperties} />
      ))}
    </div>
  )
}
