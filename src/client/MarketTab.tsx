import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogEntryView, CatalogResponse, MutationResponse, Tier } from '../types.ts'
import type { PluginHubLocaleKey } from './locales.ts'
import css from './MarketTab.module.css'

/** Registration-side face supplying host access to the tab. */
export interface MarketTabInjected {
  load: () => Promise<CatalogResponse>
  refresh: () => Promise<CatalogResponse>
  install: (id: string) => Promise<MutationResponse>
  uninstall: (name: string) => Promise<MutationResponse>
  reload: () => void
}

/** Full component props assembled by the Settings slot renderer. */
export type MarketTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginHub'>
  & InjectFace<MarketTabInjected>

type Translate = MarketTabProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready', readonly data: CatalogResponse }

type Filter = 'all' | 'installable' | 'installed'
type Sort = 'score' | 'stars' | 'updated'

/** Tier to locale key. */
const TIER_KEYS = {
  'verified-npm': 'tierVerifiedNpm',
  'verified-git': 'tierVerifiedGit',
  'likely-plugin': 'tierLikely',
  related: 'tierRelated',
} satisfies Record<Tier, PluginHubLocaleKey>

/** How many rows to render before the "show more" cut. */
const PAGE_SIZE = 40

/**
 * Whether an entry matches the search query.
 * @param entry - the catalog row.
 * @param query - the lowercased query.
 * @returns true on a match.
 */
function matches(entry: CatalogEntryView, query: string): boolean {
  if (query.length === 0) return true
  return [entry.repo, entry.packageName ?? '', entry.description, entry.summary ?? '', ...entry.tags]
    .some(value => value.toLocaleLowerCase().includes(query))
}

/**
 * Format an ISO timestamp as a short local date.
 * @param iso - the timestamp.
 * @returns a date string, or an em dash when unparsable.
 */
function shortDate(iso: string): string {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? '—' : new Date(value).toLocaleDateString()
}

/** The plugin marketplace tab. */
export function MarketTab(props: MarketTabProps): React.ReactElement {
  // The injected face arrives spread across props, not nested under a key.
  const { t, load: loadCatalog, refresh, install, uninstall, reload } = props
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('installable')
  const [sort, setSort] = useState<Sort>('score')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [needsReload, setNeedsReload] = useState(false)
  const [confirming, setConfirming] = useState<CatalogEntryView | undefined>(undefined)
  const [manual, setManual] = useState<CatalogEntryView | undefined>(undefined)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const load = useCallback(async (fresh: boolean) => {
    setView(current => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      setView({ status: 'ready', data: fresh ? await refresh() : await loadCatalog() })
    } catch {
      setView({ status: 'error' })
    }
  }, [loadCatalog, refresh])

  useEffect(() => { void load(false) }, [load])

  const entries = view.status === 'ready' ? view.data.entries : []
  const installEnabled = view.status === 'ready' && view.data.installEnabled

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const filtered = entries.filter((entry) => {
      if (!matches(entry, normalized)) return false
      if (filter === 'installed') return entry.installState !== 'not-installed'
      if (filter === 'installable') return entry.installMethod !== 'manual'
      return true
    })
    const ordered = [...filtered]
    ordered.sort((a, b) => {
      if (sort === 'stars') return b.stars - a.stars
      if (sort === 'updated') return Date.parse(b.pushedAt) - Date.parse(a.pushedAt)
      return b.score - a.score
    })
    return ordered
  }, [entries, query, filter, sort])

  /** Run a mutation and fold its outcome back into the view. */
  const runMutation = useCallback(async (
    id: string, action: () => Promise<MutationResponse>,
  ) => {
    setBusy(id)
    setNotice(undefined)
    try {
      const result = await action()
      setNotice(result.detail === undefined ? result.message : `${result.message}\n${result.detail}`)
      if (result.needsReload) setNeedsReload(true)
      // The install state lives host-side; re-read rather than guess it here.
      await load(false)
    } finally {
      setBusy(undefined)
    }
  }, [load])

  if (view.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (view.status === 'error') {
    return (
      <div className={css.status}>
        <p>{t('error')}</p>
        <button type="button" className={css.button} onClick={() => { void load(false) }}>{t('retry')}</button>
      </div>
    )
  }

  return (
    <div className={css.root} data-plugin-hub-market="">
      {needsReload && (
        <div className={css.banner} data-plugin-hub-banner="reload">
          <span>{t('reloadNeeded')}</span>
          <button type="button" className={css.button} onClick={reload}>{t('reloadNow')}</button>
        </div>
      )}
      {view.data.upgradeRequired === true && (
        <div className={css.banner} data-plugin-hub-banner="upgrade">{t('upgradeRequired')}</div>
      )}
      {!installEnabled && (
        <div className={css.banner} data-plugin-hub-banner="disabled">{t('installDisabled')}</div>
      )}
      {view.data.source !== 'remote' && (
        <div className={css.hint} data-plugin-hub-source={view.data.source}>
          {view.data.source === 'seed' ? t('sourceSeed') : t('sourceCache')}
        </div>
      )}

      <div className={css.toolbar}>
        <input
          type="search"
          className={css.search}
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }}
        />
        <div className={css.segmented} role="group">
          {(['installable', 'all', 'installed'] as const).map(key => (
            <button
              key={key}
              type="button"
              className={filter === key ? css.segmentActive : css.segment}
              aria-pressed={filter === key}
              onClick={() => { setFilter(key); setLimit(PAGE_SIZE) }}
            >
              {t(key === 'all' ? 'filterAll' : key === 'installable' ? 'filterInstallable' : 'filterInstalled')}
            </button>
          ))}
        </div>
        <select
          className={css.select}
          value={sort}
          aria-label={t('sortScore')}
          onChange={(event) => { setSort(event.target.value as Sort) }}
        >
          <option value="score">{t('sortScore')}</option>
          <option value="stars">{t('sortStars')}</option>
          <option value="updated">{t('sortUpdated')}</option>
        </select>
        <button type="button" className={css.button} onClick={() => { void load(true) }}>{t('refresh')}</button>
      </div>

      {notice !== undefined && <pre className={css.notice} data-plugin-hub-notice="">{notice}</pre>}

      {visible.length === 0
        ? <p className={css.status}>{query.trim() === '' ? t('empty') : t('emptySearch')}</p>
        : (
          <ul className={css.list}>
            {visible.slice(0, limit).map(entry => (
              <PluginRow
                key={entry.id}
                entry={entry}
                t={t}
                busy={busy === entry.id}
                installEnabled={installEnabled}
                onInstall={() => { setConfirming(entry) }}
                onUninstall={() => {
                  if (entry.packageName === undefined) return
                  void runMutation(entry.id, () => uninstall(entry.packageName as string))
                }}
                onManual={() => { setManual(entry) }}
              />
            ))}
          </ul>
        )}

      {visible.length > limit && (
        <button type="button" className={css.more} onClick={() => { setLimit(value => value + PAGE_SIZE) }}>
          +{Math.min(PAGE_SIZE, visible.length - limit)}
        </button>
      )}

      <p className={css.footer}>{t('generatedAt')}: {shortDate(view.data.meta.generatedAt)} · {view.data.meta.count}</p>

      {confirming !== undefined && (
        <ConfirmDialog
          entry={confirming}
          t={t}
          onCancel={() => { setConfirming(undefined) }}
          onConfirm={() => {
            const target = confirming
            setConfirming(undefined)
            void runMutation(target.id, () => install(target.id))
          }}
        />
      )}
      {manual !== undefined && (
        <ManualDialog entry={manual} t={t} onClose={() => { setManual(undefined) }} />
      )}
    </div>
  )
}

/** Props for one catalog row. */
interface PluginRowProps {
  readonly entry: CatalogEntryView
  readonly t: Translate
  readonly busy: boolean
  readonly installEnabled: boolean
  readonly onInstall: () => void
  readonly onUninstall: () => void
  readonly onManual: () => void
}

/** One catalog row. */
function PluginRow(props: PluginRowProps): React.ReactElement {
  const { entry, t, busy, installEnabled, onInstall, onUninstall, onManual } = props
  const isInstalled = entry.installState !== 'not-installed'
  return (
    <li className={css.card} data-plugin-hub-entry={entry.id} data-tier={entry.tier} data-state={entry.installState}>
      <div className={css.cardHead}>
        <a className={css.name} href={entry.url} target="_blank" rel="noreferrer noopener">
          {entry.packageName ?? entry.repo}
        </a>
        <span className={css.tier} data-tier={entry.tier}>{t(TIER_KEYS[entry.tier])}</span>
        <span className={css.score} title={String(entry.score)}>{entry.score}</span>
      </div>
      <p className={css.summary}>{entry.summary ?? entry.description}</p>
      <div className={css.badges}>
        {entry.hasClient && <span className={css.badge}>{t('badgeWebUi')}</span>}
        {entry.hasSkills && <span className={css.badge}>{t('badgeSkills')}</span>}
        {entry.needsApiKey && <span className={css.badge}>{t('badgeApiKey')}</span>}
        {entry.runsBuildScript && <span className={css.badgeWarn}>{t('badgeBuild')}</span>}
        {entry.tags.slice(0, 3).map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
      </div>
      <div className={css.meta}>
        <span>★ {entry.stars}</span>
        <span>{t('updated')} {shortDate(entry.pushedAt)}</span>
        <span>{entry.license ?? t('noLicense')}</span>
        {entry.installedVersion !== undefined && <span>v{entry.installedVersion}</span>}
      </div>
      <div className={css.actions}>
        {entry.installMethod === 'manual'
          ? <button type="button" className={css.button} onClick={onManual}>{t('manualOnly')}</button>
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
      </div>
    </li>
  )
}

/** The pre-install confirmation dialog. */
function ConfirmDialog(props: {
  readonly entry: CatalogEntryView
  readonly t: Translate
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): React.ReactElement {
  const { entry, t, onCancel, onConfirm } = props
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" data-plugin-hub-dialog="confirm">
      <div className={css.dialog}>
        <h3 className={css.dialogTitle}>{t('confirmTitle')}</h3>
        <dl className={css.factList}>
          <div><dt>{t('viewRepo')}</dt><dd>{entry.repo}</dd></div>
          <div><dt>{t('stars')}</dt><dd>{entry.stars}</dd></div>
          <div><dt>{t('license')}</dt><dd>{entry.license ?? t('noLicense')}</dd></div>
          <div><dt>npm</dt><dd>{entry.packageName ?? '—'}</dd></div>
        </dl>
        <p className={css.dialogBody}>{t('confirmBody')}</p>
        {entry.runsBuildScript && <p className={css.dialogWarn}>{t('confirmBuild')}</p>}
        <div className={css.dialogActions}>
          <button type="button" className={css.button} onClick={onCancel}>{t('confirmCancel')}</button>
          <button type="button" className={css.buttonPrimary} onClick={onConfirm}>{t('confirmOk')}</button>
        </div>
      </div>
    </div>
  )
}

/** Manual install instructions for entries pnpm cannot install unattended. */
function ManualDialog(props: {
  readonly entry: CatalogEntryView
  readonly t: Translate
  readonly onClose: () => void
}): React.ReactElement {
  const { entry, t, onClose } = props
  const steps = entry.manualSteps ?? [
    `git clone ${entry.url}.git`,
    `cd ${entry.repo.split('/')[1] ?? entry.repo}`,
    'pnpm install && pnpm build',
    'dsh plugin --profile web add $(pwd)',
  ]
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" data-plugin-hub-dialog="manual">
      <div className={css.dialog}>
        <h3 className={css.dialogTitle}>{t('manualTitle')}</h3>
        <p className={css.dialogBody}>{t('manualBody')}</p>
        <pre className={css.steps}>{steps.join('\n')}</pre>
        <div className={css.dialogActions}>
          <button type="button" className={css.button} onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}
