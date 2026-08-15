/**
 * The detail view for one catalog entry.
 *
 * The list answers "which plugin"; this answers "what is it, and do I trust
 * it". That means the author's own words get priority — the repository
 * description, its GitHub topics, and the full README — with the derived
 * signals (model summary, score, tier) presented as clearly secondary.
 */

import { useEffect, useState } from 'react'
import type { CatalogEntryView, ReadmeResponse } from '../types.ts'
import { fetchReadme } from './api.ts'
import type { PluginHubLocaleKey } from './locales.ts'
import { Markdown } from './Markdown.tsx'
import css from './DetailPanel.module.css'
import { Icon, Metric, TIER_KEYS, shortDate } from './ui.tsx'

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
  readonly onManual: () => void
  /** Adds a topic to the active search, so topics work as navigation. */
  readonly onTopic: (topic: string) => void
}

/** The right-hand detail panel. */
export function DetailPanel(props: DetailPanelProps): React.ReactElement {
  const { entry, t, busy, installEnabled, onClose, onInstall, onUninstall, onManual, onTopic } = props
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

  return (
    <aside className={css.panel} data-plugin-hub-detail={entry.id} aria-label={entry.repo}>
      <header className={css.head}>
        {/* The detail view replaces the list, so going back has to be the most
            obvious thing in the header — not a bare close cross. */}
        <div className={css.headTop}>
          <button type="button" className={css.back} onClick={onClose}>
            <span className={css.backChevron}><Icon name="chevron" /></span>
            {t('backToList')}
          </button>
          <span className={css.tier} data-tier={entry.tier}>{t(TIER_KEYS[entry.tier])}</span>
        </div>
        <h3 className={css.title}>{entry.packageName ?? entry.repo}</h3>
        <a className={css.repo} href={entry.url} target="_blank" rel="noreferrer noopener">
          {entry.repo}
          <Icon name="external" />
        </a>

        {/* The author's own one-liner comes first; the model's summary is
            offered underneath and labelled, never blended into it. */}
        {entry.description !== '' && <p className={css.description}>{entry.description}</p>}
        {entry.summary !== undefined && entry.summary !== entry.description && (
          <p className={css.summary}>
            <span className={css.summaryTag}>{t('summaryLabel')}</span>
            {entry.summary}
          </p>
        )}

        <div className={css.actions}>
          {entry.installMethod === 'manual'
            ? (
              <button type="button" className={css.buttonGhost} onClick={onManual}>
                {t('manualOnly')}
              </button>
            )
            : isInstalled
              ? (
                <button
                  type="button"
                  className={css.buttonDanger}
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
          <span className={css.score} title={t('scoreLabel')}>
            <span className={css.scoreValue}>{entry.score}</span>
            <span className={css.scoreUnit}>/100</span>
          </span>
        </div>
      </header>

      <div className={css.body}>
        {entry.topics.length > 0 && (
          <section className={css.section}>
            <h4 className={css.sectionTitle}>{t('topicsTitle')}</h4>
            <div className={css.chips}>
              {entry.topics.map(topic => (
                <button
                  key={topic}
                  type="button"
                  className={css.topic}
                  onClick={() => { onTopic(topic) }}
                  title={t('topicSearch')}
                >
                  {topic}
                </button>
              ))}
            </div>
          </section>
        )}

        {(entry.tags.length > 0 || entry.category !== undefined) && (
          <section className={css.section}>
            <h4 className={css.sectionTitle}>{t('tagsTitle')}</h4>
            <div className={css.chips}>
              {entry.category !== undefined && <span className={css.category}>{entry.category}</span>}
              {entry.tags.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
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
            {entry.npmVersion !== undefined && <Metric label={t('npmVersion')} value={entry.npmVersion} />}
            {entry.latestReleaseTag !== undefined && (
              <Metric label={t('latestRelease')} value={entry.latestReleaseTag} />
            )}
          </dl>
        </section>

        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('installTitle')}</h4>
          {/* The author's own instruction, when there is one, shown before what
              will actually run — they are often the same, and naming the gap is
              the whole point of the hint. */}
          {entry.installHint !== undefined && entry.installHint.command !== '' && (
            <p className={css.hint}>
              {t('authorSays')}
              <code className={css.hintCommand}>{entry.installHint.command}</code>
            </p>
          )}
          {entry.installSpec !== undefined
            ? (
              <>
                <pre className={css.spec}>pnpm add {entry.installSpec}</pre>
                {entry.runsBuildScript && <p className={css.warn}>{t('confirmBuild')}</p>}
              </>
            )
            : (
              <>
                <p className={css.note}>{t('manualBody')}</p>
                <pre className={css.spec}>
                  {(entry.manualSteps ?? [
                    `git clone ${entry.url}.git`,
                    `cd ${entry.repo.split('/')[1] ?? entry.repo}`,
                    'pnpm install && pnpm build',
                    'dsh plugin --profile web add $(pwd)',
                  ]).join('\n')}
                </pre>
              </>
            )}
        </section>

        <section className={css.section}>
          <h4 className={css.sectionTitle}>
            {t('readmeTitle')}
            {readme.status === 'ready' && readme.data.sourceUrl !== undefined && (
              <a
                className={css.sectionLink}
                href={`${entry.url}#readme`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('viewOnGithub')}
              </a>
            )}
          </h4>
          {readme.status === 'loading' && <ReadmeSkeleton />}
          {readme.status === 'ready' && (readme.data.ok && readme.data.markdown.trim() !== ''
            ? <Markdown source={readme.data.markdown} baseUrl={readme.data.sourceUrl} />
            : (
              <p className={css.note}>
                {t('readmeUnavailable')}
                <a className={css.inlineLink} href={entry.url} target="_blank" rel="noreferrer noopener">
                  {t('viewRepo')}
                </a>
              </p>
            ))}
        </section>
      </div>
    </aside>
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
