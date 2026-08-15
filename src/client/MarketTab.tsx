import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogEntryView, CatalogResponse, MutationResponse } from '../types.ts'
import { DetailPanel } from './DetailPanel.tsx'
import type { PluginHubLocaleKey } from './locales.ts'
import { Icon, TIER_KEYS, compact, relativeAge } from './ui.tsx'
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

type Translate = (key: PluginHubLocaleKey) => string

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready', readonly data: CatalogResponse }

type Filter = 'all' | 'installable' | 'installed'
type Sort = 'score' | 'stars' | 'updated'

/** How many rows are rendered per page as the list scrolls. */
const PAGE_SIZE = 30

/**
 * Grow `limit` whenever a sentinel near the end of the list comes into view.
 *
 * The scroll container is the Settings dialog, not this component, so the
 * observer is left with the default root — the viewport — which sees the
 * sentinel regardless of which ancestor actually scrolls. `rootMargin` starts
 * the next page before the user reaches the bottom, so the list feels
 * continuous rather than paged.
 * @param sentinel - the element rendered after the last row.
 * @param hasMore - whether anything is left to reveal.
 * @param grow - called to extend the rendered window.
 */
function useEndlessScroll(
  sentinel: RefObject<HTMLDivElement | null>, hasMore: boolean, grow: () => void,
): void {
  useEffect(() => {
    const node = sentinel.current
    if (node === null || !hasMore) return undefined
    const observer = new IntersectionObserver((records) => {
      if (records.some(record => record.isIntersecting)) grow()
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [sentinel, hasMore, grow])
}

/**
 * Whether an entry matches the search query.
 *
 * Topics are searched alongside the model's tags, so a repository can be found
 * by the words its author chose for it.
 * @param entry - the catalog row.
 * @param query - the lowercased query.
 * @returns true on a match.
 */
function matches(entry: CatalogEntryView, query: string): boolean {
  if (query.length === 0) return true
  return [
    entry.repo,
    entry.packageName ?? '',
    entry.description,
    entry.summary ?? '',
    entry.category ?? '',
    ...entry.tags,
    ...entry.topics,
  ].some(value => value.toLocaleLowerCase().includes(query))
}

/** The plugin marketplace tab. */
export function MarketTab(props: MarketTabProps): React.ReactElement {
  // The injected face arrives spread across props, not nested under a key.
  const { t, load: loadCatalog, refresh, install, uninstall, reload } = props
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('installable')
  const [sort, setSort] = useState<Sort>('stars')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<{ text: string, ok: boolean } | undefined>(undefined)
  const [needsReload, setNeedsReload] = useState(false)
  const [confirming, setConfirming] = useState<CatalogEntryView | undefined>(undefined)
  const [manual, setManual] = useState<CatalogEntryView | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [refreshing, setRefreshing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (fresh: boolean) => {
    setView(current => (current.status === 'ready' ? current : { status: 'loading' }))
    if (fresh) setRefreshing(true)
    try {
      setView({ status: 'ready', data: fresh ? await refresh() : await loadCatalog() })
    } catch {
      setView({ status: 'error' })
    } finally {
      setRefreshing(false)
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

  // The panel follows the list: a selection that filtering removed would
  // otherwise linger, describing something no longer on screen.
  const active = useMemo(
    () => visible.find(entry => entry.id === selected),
    [visible, selected],
  )

  // What the current query would find if the tier filter were not applied.
  // Sorting by stars inside "one-click" hides most of the catalog — 23 of the
  // top 25 by stars are not installable — and a filter that silently removes
  // what you asked to sort by is indistinguishable from a broken crawler.
  const widerCount = useMemo(() => {
    if (filter === 'all') return 0
    const normalized = query.trim().toLocaleLowerCase()
    return entries.filter(entry => matches(entry, normalized)).length
  }, [entries, query, filter])

  const grow = useCallback(() => { setLimit(value => value + PAGE_SIZE) }, [])
  useEndlessScroll(sentinelRef, visible.length > limit, grow)

  /** Run a mutation and fold its outcome back into the view. */
  const runMutation = useCallback(async (
    id: string, action: () => Promise<MutationResponse>,
  ) => {
    setBusy(id)
    setNotice(undefined)
    try {
      const result = await action()
      const text = result.detail === undefined ? result.message : `${result.message}\n${result.detail}`
      setNotice({ text, ok: result.ok })
      if (result.needsReload) setNeedsReload(true)
      // The install state lives host-side; re-read rather than guess it here.
      await load(false)
    } finally {
      setBusy(undefined)
    }
  }, [load])

  /**
   * Search for a topic, from a chip in the detail panel.
   *
   * The filter widens to "all" because a topic is the author's own word for
   * their project, and restricting the result to one-click-installable entries
   * would silently drop most of what the click promised. Focus is deferred:
   * this runs while the detail view is still mounted, so the list's search
   * input does not exist yet.
   */
  const searchTopic = useCallback((topic: string) => {
    setQuery(topic)
    setFilter('all')
    setLimit(PAGE_SIZE)
    requestAnimationFrame(() => { searchRef.current?.focus() })
  }, [])

  if (view.status === 'loading') return <ListSkeleton />
  if (view.status === 'error') {
    return (
      <div className={css.blank} data-plugin-hub-state="error">
        <p className={css.blankTitle}>{t('error')}</p>
        <button type="button" className={css.buttonGhost} onClick={() => { void load(false) }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The Settings dialog gives this tab a single ~560px column, so the detail
  // view replaces the list rather than sitting beside it. A side-by-side split
  // would have to collapse at every real width it is ever rendered at.
  if (active !== undefined) {
    return (
      <div className={css.root} data-plugin-hub-market="" data-detail="open">
        {/* A mutation's outcome must reach the user even from the detail view:
            an install that fails here would otherwise look like it did nothing. */}
        {notice !== undefined && (
          <pre className={css.notice} data-tone={notice.ok ? undefined : 'error'} data-plugin-hub-notice="">{notice.text}</pre>
        )}
        <DetailPanel
          key={active.id}
          entry={active}
          t={t}
          busy={busy === active.id}
          installEnabled={installEnabled}
          onClose={() => { setSelected(undefined) }}
          onInstall={() => { setConfirming(active) }}
          onUninstall={() => {
            if (active.packageName === undefined) return
            void runMutation(active.id, () => uninstall(active.packageName as string))
          }}
          onManual={() => { setManual(active) }}
          onTopic={(topic) => { setSelected(undefined); searchTopic(topic) }}
        />
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

  return (
    <div className={css.root} data-plugin-hub-market="" data-detail="closed">
      {needsReload && (
        <div className={css.banner} data-plugin-hub-banner="reload">
          <span>{t('reloadNeeded')}</span>
          <button type="button" className={css.buttonGhost} onClick={reload}>{t('reloadNow')}</button>
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

      {/* Two deliberate rows: at the width this dialog actually gives us, one
          row would wrap anyway, and a wrapped row reads as a mistake. */}
      <div className={css.toolbar}>
        <div className={css.searchWrap}>
          <span className={css.searchIcon}><Icon name="search" /></span>
          <input
            ref={searchRef}
            type="search"
            className={css.search}
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }}
          />
        </div>
        <button
          type="button"
          className={css.iconButton}
          onClick={() => { void load(true) }}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
          data-spinning={refreshing ? '' : undefined}
        >
          <Icon name="refresh" />
        </button>
      </div>

      <div className={css.filterRow}>
        <div className={css.segmented} role="group">
          {(['installable', 'all', 'installed'] as const).map(key => (
            <button
              key={key}
              type="button"
              className={css.segment}
              data-active={filter === key ? '' : undefined}
              aria-pressed={filter === key}
              onClick={() => { setFilter(key); setLimit(PAGE_SIZE) }}
            >
              {t(key === 'all' ? 'filterAll' : key === 'installable' ? 'filterInstallable' : 'filterInstalled')}
            </button>
          ))}
        </div>
        <SortSelect value={sort} onChange={setSort} t={t} />
        {/* The denominator is the point: it shows how much the tier filter is
            holding back, which is invisible from the numerator alone. */}
        <span className={css.countLine}>
          <span className={css.count}>{visible.length}</span>
          {filter !== 'all' && <span className={css.countTotal}>/ {entries.length}</span>}
          <span>{t('countSuffix')}</span>
        </span>
      </div>

      {filter !== 'all' && widerCount > visible.length && (
        <button
          type="button"
          className={css.widen}
          onClick={() => { setFilter('all'); setLimit(PAGE_SIZE) }}
          data-plugin-hub-widen=""
        >
          {t('hiddenPrefix')}
          <span className={css.num}>{widerCount - visible.length}</span>
          {t('hiddenSuffix')}
        </button>
      )}

      {notice !== undefined && (
        <pre className={css.notice} data-tone={notice.ok ? undefined : 'error'} data-plugin-hub-notice="">{notice.text}</pre>
      )}

      <div className={css.listPane}>
        {visible.length === 0
            ? (
              <div className={css.blank} data-plugin-hub-state="empty">
                <span className={css.blankIcon}><Icon name="empty" size={26} /></span>
                <p className={css.blankTitle}>{query.trim() === '' ? t('empty') : t('emptySearch')}</p>
                {query.trim() !== '' && (
                  <>
                    <p className={css.blankBody}>{t('emptyHint')}</p>
                    <button
                      type="button"
                      className={css.buttonGhost}
                      onClick={() => { setQuery(''); setFilter('all') }}
                    >
                      {t('emptyClear')}
                    </button>
                  </>
                )}
              </div>
            )
            : (
              <ul className={css.list}>
                {visible.slice(0, limit).map((entry, index) => (
                  <PluginRow
                    key={entry.id}
                    entry={entry}
                    index={index}
                    t={t}
                    busy={busy === entry.id}
                    installEnabled={installEnabled}
                    selected={entry.id === selected}
                    onSelect={() => { setSelected(current => (current === entry.id ? undefined : entry.id)) }}
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

        {/* Loading more is scroll-driven; this only marks the trigger point.
            A pulsing animation here reads as "fetching from the network" when
            nothing is being fetched at all. */}
        {visible.length > limit && (
          <div ref={sentinelRef} className={css.sentinel} data-plugin-hub-sentinel="">
            {t('moreBelow')}
            <span className={css.num}>{visible.length - limit}</span>
            {t('moreBelowSuffix')}
          </div>
        )}
      </div>

      <p className={css.footer}>
        {t('generatedAt')} {relativeAge(view.data.meta.generatedAt, t)} · {view.data.meta.count}
      </p>

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
  readonly index: number
  readonly t: Translate
  readonly busy: boolean
  readonly installEnabled: boolean
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onInstall: () => void
  readonly onUninstall: () => void
  readonly onManual: () => void
}

/**
 * One catalog row.
 *
 * Rows are hairline-separated rather than boxed: at this density a border per
 * entry turns the list into a wall of rectangles, and elevation carries no
 * meaning here because nothing floats above anything else.
 * @param props - the entry and its handlers.
 * @returns the row.
 */
function PluginRow(props: PluginRowProps): React.ReactElement {
  const { entry, index, t, busy, installEnabled, selected, onSelect, onInstall, onUninstall, onManual } = props
  const isInstalled = entry.installState !== 'not-installed'
  return (
    <li
      className={css.row}
      style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
      data-plugin-hub-entry={entry.id}
      data-tier={entry.tier}
      data-state={entry.installState}
      data-selected={selected ? '' : undefined}
    >
      {/* The whole row opens the detail view; the action button stops the
          event so installing never doubles as navigation. */}
      <button type="button" className={css.rowOpen} onClick={onSelect} aria-expanded={selected}>
        <span className={css.rowMain}>
          <span className={css.nameLine}>
            <span className={css.name}>{entry.packageName ?? entry.repo}</span>
            <span className={css.tier} data-tier={entry.tier}>{t(TIER_KEYS[entry.tier])}</span>
            {isInstalled && <span className={css.installed}>{t('installed')}</span>}
          </span>
          <span className={css.summary}>{entry.summary ?? (entry.description || entry.repo)}</span>
          <span className={css.metaLine}>
            <span className={css.metaItem}>
              <Icon name="star" />
              <span className={css.num}>{compact(entry.stars)}</span>
            </span>
            <span className={css.metaItem}>{relativeAge(entry.pushedAt, t)}</span>
            {entry.license !== undefined && <span className={css.metaItem}>{entry.license}</span>}
            {entry.hasClient && <span className={css.cap}>{t('badgeWebUi')}</span>}
            {entry.hasSkills && <span className={css.cap}>{t('badgeSkills')}</span>}
            {entry.needsApiKey && <span className={css.cap}>{t('badgeApiKey')}</span>}
            {entry.topics.slice(0, 3).map(topic => (
              <span key={topic} className={css.topic}>{topic}</span>
            ))}
          </span>
        </span>
      </button>
      <div className={css.rowAction}>
        {entry.installMethod === 'manual'
          ? (
            <button type="button" className={css.buttonGhost} onClick={onManual}>
              {t('manualShort')}
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
      </div>
    </li>
  )
}

/**
 * Placeholder rows shown during the first load.
 * @returns the skeleton list.
 */
function ListSkeleton(): React.ReactElement {
  return (
    <div className={css.root} aria-busy="true" data-plugin-hub-state="loading">
      <div className={css.skelToolbar} />
      <ul className={css.list}>
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className={css.skelRow} style={{ '--i': index } as React.CSSProperties}>
            <span className={css.skelName} />
            <span className={css.skelSummary} />
            <span className={css.skelMeta} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Props for {@link SortSelect}. */
interface SortSelectProps {
  readonly value: Sort
  readonly onChange: (sort: Sort) => void
  readonly t: Translate
}

/**
 * The sort picker.
 *
 * The native `<select>` renders with the OS's own chrome — a blue glow on
 * focus, a dropdown that ignores the page's theme — and there is no way to
 * style it away. This is a button plus a popover instead, so it sits in the
 * same visual language as the segmented filter beside it.
 * @param props - the current sort and its handler.
 * @returns the picker.
 */
function SortSelect(props: SortSelectProps): React.ReactElement {
  const { value, onChange, t } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere outside the popover closes it; there is no modal
  // backdrop, so the rest of the page stays interactive.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  const options: { value: Sort, label: PluginHubLocaleKey }[] = [
    { value: 'stars', label: 'sortStars' },
    { value: 'score', label: 'sortScore' },
    { value: 'updated', label: 'sortUpdated' },
  ]

  return (
    <div ref={rootRef} className={css.sortRoot}>
      <button
        type="button"
        className={css.sortButton}
        onClick={() => { setOpen(current => !current) }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {t(options.find(option => option.value === value)?.label ?? 'sortStars')}
        <span className={css.sortChevron} data-open={open ? '' : undefined}><Icon name="chevron" /></span>
      </button>
      {open && (
        <ul className={css.sortMenu} role="listbox">
          {options.map(option => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={css.sortOption}
                data-active={option.value === value ? '' : undefined}
                onClick={() => { onChange(option.value); setOpen(false) }}
              >
                {t(option.label)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
          <div><dt>{t('stars')}</dt><dd className={css.num}>{compact(entry.stars)}</dd></div>
          <div><dt>{t('license')}</dt><dd>{entry.license ?? t('noLicense')}</dd></div>
          <div><dt>npm</dt><dd>{entry.packageName ?? '—'}</dd></div>
        </dl>
        {/* What runs is the catalog's normalized spec — the same thing
            `dsh plugin add` would run. The author's README wording is shown
            underneath for reference when it differs. */}
        <p className={css.dialogLabel}>{t('willRun')}</p>
        <pre className={css.commandBlock}>pnpm add {entry.installSpec}</pre>
        {entry.installHint !== undefined && entry.installHint.command !== ''
          && entry.installHint.command !== `pnpm add ${entry.installSpec ?? ''}` && (
          <p className={css.hintCompare}>
            {t('authorSays')} <code>{entry.installHint.command}</code>
          </p>
        )}
        <p className={css.dialogBody}>{t('confirmBody')}</p>
        {entry.runsBuildScript && <p className={css.dialogWarn}>{t('confirmBuild')}</p>}
        <div className={css.dialogActions}>
          <button type="button" className={css.buttonGhost} onClick={onCancel}>{t('confirmCancel')}</button>
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
          <button type="button" className={css.buttonGhost} onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}
