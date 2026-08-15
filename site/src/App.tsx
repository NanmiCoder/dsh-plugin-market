import {
  ArrowUpRight,
  CaretLeft,
  Check,
  Copy,
  GithubLogo,
  IconContext,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  Star,
  TerminalWindow,
  WarningCircle,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'

type Language = 'en' | 'zh'
type Tier = 'verified-npm' | 'verified-git' | 'likely-plugin' | 'related'
type Filter = 'all' | 'installable' | 'webui' | 'manual'
type Sort = 'score' | 'stars' | 'updated'
type CopyState = 'idle' | 'copied' | 'error'

interface CatalogEntry {
  readonly id: string
  readonly repo: string
  readonly owner: string
  readonly url: string
  readonly tier: Tier
  readonly packageName?: string
  readonly installMethod: 'npm' | 'git' | 'manual'
  readonly installSpec?: string
  readonly description: string
  readonly summary?: string
  readonly summaryEn?: string
  readonly category?: string
  readonly tags: readonly string[]
  readonly topics: readonly string[]
  readonly stars: number
  readonly forks: number
  readonly score: number
  readonly pushedAt: string
  readonly language?: string
  readonly license?: string
  readonly npmVersion?: string
  readonly hasClient: boolean
  readonly hasSkills: boolean
  readonly needsApiKey: boolean
}

const entries = __PREVIEW_ENTRIES__ as readonly CatalogEntry[]
const installCommand = 'dsh plugin --profile web add @nanmicoder/dsh-plugin-market'

const copy = {
  en: {
    navPreview: 'Live preview',
    heroKicker: 'VERIFIED PLUGIN DISCOVERY',
    heroTitle: 'Inspect the plugin. Then install it.',
    heroBody: 'Search the DSH ecosystem through normalized evidence. Package identity, host compatibility, install specs, and Web UI support stay visible before anything runs.',
    openCatalog: 'Open the catalog',
    source: 'View source',
    copyInstall: 'Copy install command',
    commandCopied: 'Install command copied',
    copyFailed: 'Clipboard unavailable. Select the command manually.',
    verificationRoute: 'Verification route',
    rulesOnline: 'RULESET ONLINE',
    repositoryInput: 'repository candidates',
    manifest: 'manifest',
    patch: 'patch shape',
    packageFence: 'package fence',
    installReady: 'install-ready specs',
    npmVerified: 'npm verified',
    sourceVerified: 'source verified',
    clientUi: 'client UIs detected',
    catalogKicker: 'INTERACTIVE PRODUCT PREVIEW',
    catalogTitle: 'The catalog is the product.',
    catalogBody: 'Use the same search, evidence panel, and install boundary as the DSH Web UI. This public preview never executes an installation.',
    liveCatalog: 'CATALOG ONLINE',
    snapshot: 'Snapshot',
    search: 'Search repo, package, topic, or capability',
    filterLabel: 'Filter catalog',
    sortLabel: 'Sort catalog',
    all: 'All',
    installable: 'Install-ready',
    webui: 'Web UI',
    manual: 'Manual review',
    best: 'Best evidence',
    starsSort: 'Most starred',
    updated: 'Recently updated',
    results: 'results',
    clear: 'Reset view',
    noResultsTitle: 'Nothing matches this search',
    noResultsBody: 'Try a package name, a repository owner, or reset the active filters.',
    catalogErrorTitle: 'The catalog could not be loaded',
    catalogErrorBody: 'The preview data is missing from this build. Check the generated catalog and rebuild the site.',
    verifiedNpm: 'Verified npm',
    verifiedGit: 'Verified source',
    likely: 'Manual review',
    related: 'Ecosystem',
    score: 'Evidence score',
    stars: 'GitHub stars',
    overview: 'Evidence summary',
    topics: 'Repository topics',
    install: 'Install boundary',
    previewMode: 'Preview only · no host action is executed',
    copyCommand: 'Copy command',
    copied: 'Copied',
    openRepo: 'Open repository',
    back: 'Back to results',
    package: 'Package',
    license: 'License',
    updatedLabel: 'Updated',
    needsKey: 'API key',
    skills: 'Skills',
    client: 'Web UI',
    noSpec: 'No executable spec is exposed. Review this repository manually.',
    trustKicker: 'TRUST MODEL',
    trustTitle: 'README describes intent. The catalog defines the boundary.',
    trustBody: 'Repository prose is never executed. Only normalized specs that pass tier, manifest, patch, and character checks reach the host install action.',
    footer: 'Open-source infrastructure for the DeepSeek Harness plugin ecosystem.',
  },
  zh: {
    navPreview: '产品预览',
    heroKicker: '可信插件发现',
    heroTitle: '先看清插件，再决定安装。',
    heroBody: '用规范化证据检索 DSH 插件生态。包身份、宿主兼容性、安装 spec 和 Web UI 支持，在任何操作执行前都清楚可见。',
    openCatalog: '打开插件目录',
    source: '查看源码',
    copyInstall: '复制安装命令',
    commandCopied: '安装命令已复制',
    copyFailed: '剪贴板不可用，请手动选择命令。',
    verificationRoute: '验证路径',
    rulesOnline: '规则集在线',
    repositoryInput: '个候选仓库',
    manifest: '清单核验',
    patch: 'Patch 形态',
    packageFence: '包名围栏',
    installReady: '个可安装 spec',
    npmVerified: 'npm 已验证',
    sourceVerified: '源码已验证',
    clientUi: '个 Web UI',
    catalogKicker: '可交互产品预览',
    catalogTitle: '目录本身，就是产品。',
    catalogBody: '直接体验与 DSH Web UI 相同的搜索、证据面板和安装边界。公开预览站不会执行任何安装操作。',
    liveCatalog: '目录在线',
    snapshot: '目录快照',
    search: '搜索仓库、包名、Topic 或能力',
    filterLabel: '筛选插件目录',
    sortLabel: '排序插件目录',
    all: '全部',
    installable: '可安装',
    webui: '带 Web UI',
    manual: '人工检查',
    best: '证据最佳',
    starsSort: 'Star 最多',
    updated: '最近更新',
    results: '条结果',
    clear: '重置视图',
    noResultsTitle: '没有匹配的插件',
    noResultsBody: '可以尝试包名、仓库作者，或重置当前筛选条件。',
    catalogErrorTitle: '插件目录加载失败',
    catalogErrorBody: '当前构建没有注入预览数据，请检查生成的目录并重新构建站点。',
    verifiedNpm: 'npm 已验证',
    verifiedGit: '源码已验证',
    likely: '人工检查',
    related: '生态相关',
    score: '证据评分',
    stars: 'GitHub Star',
    overview: '证据摘要',
    topics: '仓库 Topics',
    install: '安装边界',
    previewMode: '仅供预览 · 不会执行宿主操作',
    copyCommand: '复制命令',
    copied: '已复制',
    openRepo: '打开仓库',
    back: '返回结果',
    package: '包名',
    license: '许可证',
    updatedLabel: '更新于',
    needsKey: '需要 API Key',
    skills: 'Skills',
    client: 'Web UI',
    noSpec: '该条目没有暴露可执行 spec，请先人工检查仓库。',
    trustKicker: '信任模型',
    trustTitle: 'README 描述意图，目录定义边界。',
    trustBody: '仓库文案不会被执行。只有同时通过层级、清单、Patch 与字符围栏检查的规范化 spec，才能进入宿主安装操作。',
    footer: '面向 DeepSeek Harness 插件生态的开源基础设施。',
  },
} as const

function tierLabel(tier: Tier, language: Language): string {
  const t = copy[language]
  if (tier === 'verified-npm') return t.verifiedNpm
  if (tier === 'verified-git') return t.verifiedGit
  if (tier === 'likely-plugin') return t.likely
  return t.related
}

function compact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function relativeDate(value: string, language: Language): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000))
  if (language === 'zh') {
    if (days === 0) return '今天'
    if (days < 30) return `${days} 天前`
    if (days < 365) return `${Math.floor(days / 30)} 个月前`
    return `${Math.floor(days / 365)} 年前`
  }
  if (days === 0) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function useClipboard(): readonly [CopyState, (value: string) => Promise<void>, () => void] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => { window.clearTimeout(timer.current) }, [])

  const reset = (): void => {
    window.clearTimeout(timer.current)
    setState('idle')
  }

  const write = async (value: string): Promise<void> => {
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('error')
    }
    timer.current = window.setTimeout(() => { setState('idle') }, 2400)
  }

  return [state, write, reset]
}

function Brand({ compact: small = false }: { readonly compact?: boolean }): React.ReactElement {
  return (
    <span className="brand-lockup">
      <span className="brand-mark" data-compact={small ? '' : undefined} aria-hidden="true"><span /></span>
      <span className="brand-name">DSH <strong>MARKET</strong></span>
    </span>
  )
}

function AppHeader({ language, setLanguage }: {
  readonly language: Language
  readonly setLanguage: (language: Language) => void
}): React.ReactElement {
  const t = copy[language]
  return (
    <header className="site-header">
      <a href="#top" aria-label="DSH Plugin Market home"><Brand /></a>
      <nav aria-label="Primary navigation">
        <a href="#market">{t.navPreview}</a>
        <a href="https://github.com/NanmiCoder/dsh-plugin-market" target="_blank" rel="noreferrer">
          GitHub <ArrowUpRight />
        </a>
        <div className="language-switch" role="group" aria-label="Language">
          <button type="button" aria-pressed={language === 'en'} data-active={language === 'en' ? '' : undefined} onClick={() => { setLanguage('en') }}>EN</button>
          <button type="button" aria-pressed={language === 'zh'} data-active={language === 'zh' ? '' : undefined} onClick={() => { setLanguage('zh') }}>中</button>
        </div>
      </nav>
    </header>
  )
}

function Hero({ language }: { readonly language: Language }): React.ReactElement {
  const t = copy[language]
  const [copyState, writeCommand] = useClipboard()
  return (
    <section className="hero" id="top">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="section-kicker"><ShieldCheck />{t.heroKicker}</p>
          <h1>{t.heroTitle}</h1>
          <p className="hero-body">{t.heroBody}</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#market">{t.openCatalog}<ArrowUpRight /></a>
            <a className="button button-secondary" href="https://github.com/NanmiCoder/dsh-plugin-market" target="_blank" rel="noreferrer"><GithubLogo />{t.source}</a>
          </div>
          <button className="install-command" type="button" onClick={() => { void writeCommand(installCommand) }} aria-label={t.copyInstall}>
            <TerminalWindow />
            <code>{installCommand}</code>
            <span>{copyState === 'copied' ? <Check /> : <Copy />}</span>
          </button>
          <p className="command-feedback" data-error={copyState === 'error' ? '' : undefined} aria-live="polite">
            {copyState === 'copied' ? t.commandCopied : copyState === 'error' ? t.copyFailed : '\u00a0'}
          </p>
        </div>

        <div className="verification-board" aria-label={t.verificationRoute}>
          <div className="board-header">
            <span>{t.verificationRoute}</span>
            <span className="online-status"><i />{t.rulesOnline}</span>
          </div>
          <div className="route-diagram">
            <div className="route-node route-input">
              <span className="route-index">INPUT / 01</span>
              <strong>{compact(__CATALOG_STATS__.total)}</strong>
              <span>{t.repositoryInput}</span>
            </div>
            <div className="route-track" aria-label="Verification checks">
              {[t.manifest, t.patch, t.packageFence].map((label, index) => (
                <span key={label} style={{ '--route-index': index } as React.CSSProperties}><Check />{label}</span>
              ))}
            </div>
            <div className="route-node route-output">
              <span className="route-index">OUTPUT / 02</span>
              <strong>{compact(__CATALOG_STATS__.oneClick)}</strong>
              <span>{t.installReady}</span>
            </div>
          </div>
          <dl className="route-stats">
            <div><dt>{t.npmVerified}</dt><dd>{__CATALOG_STATS__.npm}</dd></div>
            <div><dt>{t.sourceVerified}</dt><dd>{__CATALOG_STATS__.git}</dd></div>
            <div><dt>{t.clientUi}</dt><dd>{compact(__CATALOG_STATS__.webUi)}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  )
}

function CatalogSkeleton(): React.ReactElement {
  return (
    <div className="catalog-list" aria-busy="true" aria-label="Loading catalog">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="catalog-row skeleton-row" key={index}>
          <span className="skeleton-dot" />
          <span className="skeleton-copy"><i /><b /><i /></span>
          <span className="skeleton-score" />
        </div>
      ))}
    </div>
  )
}

function CatalogList({ language, filtered, selectedId, onSelect, onClear }: {
  readonly language: Language
  readonly filtered: readonly CatalogEntry[]
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly onClear: () => void
}): React.ReactElement {
  const t = copy[language]
  if (filtered.length === 0) {
    return (
      <div className="empty-state">
        <WarningCircle />
        <strong>{t.noResultsTitle}</strong>
        <p>{t.noResultsBody}</p>
        <button type="button" className="text-button" onClick={onClear}>{t.clear}<ArrowUpRight /></button>
      </div>
    )
  }
  return (
    <div className="catalog-list" aria-label="Plugin catalog">
      {filtered.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={entry.id === selectedId}
          className="catalog-row"
          data-active={entry.id === selectedId ? '' : undefined}
          style={{ '--row-index': Math.min(index, 8) } as React.CSSProperties}
          onClick={() => { onSelect(entry.id) }}
        >
          <span className="tier-dot" data-tier={entry.tier} />
          <span className="row-main">
            <span className="row-kicker"><b>{tierLabel(entry.tier, language)}</b><span>{entry.category ?? 'other'}</span></span>
            <strong>{entry.repo}</strong>
            <span className="row-summary">{language === 'zh' ? (entry.summary ?? entry.description) : (entry.summaryEn ?? entry.summary ?? entry.description)}</span>
          </span>
          <span className="row-stats">
            <span><Star />{compact(entry.stars)}</span>
            <span className="score-chip">{entry.score}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function DetailSkeleton(): React.ReactElement {
  return (
    <aside className="detail-panel detail-skeleton" aria-busy="true">
      <span className="skeleton-line skeleton-label" />
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-short" />
      <div className="skeleton-grid"><span /><span /><span /><span /></div>
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-short" />
    </aside>
  )
}

function Detail({ entry, language, mobileOpen, onBack }: {
  readonly entry: CatalogEntry | undefined
  readonly language: Language
  readonly mobileOpen: boolean
  readonly onBack: () => void
}): React.ReactElement {
  const t = copy[language]
  const [copyState, writeCommand, resetCopy] = useClipboard()
  useEffect(() => { resetCopy() }, [entry?.id])

  if (entry === undefined) return <aside className="detail-panel" />
  const command = entry.installSpec === undefined ? undefined : `dsh plugin --profile web add ${entry.installSpec}`

  return (
    <aside className="detail-panel" data-mobile-open={mobileOpen ? '' : undefined} aria-label={`${entry.repo} details`}>
      <button className="mobile-back" type="button" onClick={onBack}><CaretLeft />{t.back}</button>
      <div className="detail-scroll" key={entry.id}>
        <div className="detail-heading">
          <span className="tier-label" data-tier={entry.tier}><i />{tierLabel(entry.tier, language)}</span>
          <h3>{entry.repo}</h3>
          <p>{language === 'zh' ? (entry.summary ?? entry.description) : (entry.summaryEn ?? entry.summary ?? entry.description)}</p>
        </div>

        <div className="feature-flags" aria-label="Plugin capabilities">
          {entry.hasClient && <span>{t.client}</span>}
          {entry.hasSkills && <span>{t.skills}</span>}
          {entry.needsApiKey && <span>{t.needsKey}</span>}
        </div>

        <dl className="evidence-grid">
          <div><dt>{t.score}</dt><dd>{entry.score}<i>/100</i></dd></div>
          <div><dt>{t.stars}</dt><dd>{compact(entry.stars)}</dd></div>
          <div><dt>{t.package}</dt><dd>{entry.packageName ?? '—'}</dd></div>
          <div><dt>{t.updatedLabel}</dt><dd>{relativeDate(entry.pushedAt, language)}</dd></div>
        </dl>

        <section className="detail-section">
          <div className="section-label"><span>01</span>{t.overview}</div>
          <p>{entry.description}</p>
        </section>

        <section className="detail-section">
          <div className="section-label"><span>02</span>{t.topics}</div>
          <div className="topic-list">
            {(entry.topics.length > 0 ? entry.topics : entry.tags).slice(0, 8).map(topic => <span key={topic}>{topic}</span>)}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-label"><span>03</span>{t.install}</div>
          {command === undefined ? (
            <p className="manual-note"><WarningCircle />{t.noSpec}</p>
          ) : (
            <div className="command-box"><TerminalWindow /><code>{command}</code></div>
          )}
          <div className="detail-actions">
            <button className="button button-primary" type="button" disabled={command === undefined} onClick={() => { if (command !== undefined) void writeCommand(command) }}>
              {copyState === 'copied' ? <Check /> : <Copy />}{copyState === 'copied' ? t.copied : t.copyCommand}
            </button>
            <a className="button button-secondary" href={entry.url} target="_blank" rel="noreferrer">{t.openRepo}<ArrowUpRight /></a>
          </div>
          <span className="preview-note"><i />{t.previewMode}</span>
          {copyState === 'error' && <p className="inline-error" role="alert">{t.copyFailed}</p>}
        </section>
      </div>
    </aside>
  )
}

function MarketPreview({ language }: { readonly language: Language }): React.ReactElement {
  const t = copy[language]
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('installable')
  const [sort, setSort] = useState<Sort>('score')
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.id)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => { setLoading(false) }, 360)
    return () => { window.clearTimeout(timer) }
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const result = entries.filter((entry) => {
      if (filter === 'installable' && !entry.tier.startsWith('verified-')) return false
      if (filter === 'webui' && !entry.hasClient) return false
      if (filter === 'manual' && entry.installMethod !== 'manual') return false
      if (normalized.length === 0) return true
      return [entry.repo, entry.owner, entry.packageName ?? '', entry.description, entry.summary ?? '', entry.summaryEn ?? '', ...entry.tags, ...entry.topics]
        .some(value => value.toLocaleLowerCase().includes(normalized))
    })
    return [...result].sort((a, b) => {
      if (sort === 'stars') return b.stars - a.stars
      if (sort === 'updated') return Date.parse(b.pushedAt) - Date.parse(a.pushedAt)
      return b.score - a.score
    })
  }, [filter, query, sort])

  useEffect(() => {
    if (!filtered.some(entry => entry.id === selectedId)) setSelectedId(filtered[0]?.id)
  }, [filtered, selectedId])

  const active = filtered.find(entry => entry.id === selectedId)
  const clear = (): void => { setQuery(''); setFilter('all') }

  return (
    <section className="preview-section" id="market">
      <div className="preview-intro">
        <div>
          <p className="section-kicker"><Package />{t.catalogKicker}</p>
          <h2>{t.catalogTitle}</h2>
        </div>
        <p>{t.catalogBody}</p>
      </div>

      <div className="market-shell">
        <div className="market-topbar">
          <div><Brand compact /><span className="product-slash">/</span><b>Plugin Catalog</b></div>
          <span className="online-status"><i />{t.liveCatalog}</span>
          <span className="snapshot">{t.snapshot} · {new Date(__CATALOG_STATS__.generatedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>
        </div>

        {entries.length === 0 ? (
          <div className="catalog-error" role="alert">
            <WarningCircle />
            <strong>{t.catalogErrorTitle}</strong>
            <p>{t.catalogErrorBody}</p>
          </div>
        ) : (
          <div className="market-layout">
            <div className="catalog-pane">
              <div className="catalog-controls">
                <label className="search-field">
                  <span className="field-label">{t.search}</span>
                  <span className="search-control"><MagnifyingGlass /><input value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t.search} type="search" /></span>
                </label>
                <div className="filter-line">
                  <div className="filter-group" role="group" aria-label={t.filterLabel}>
                    {(['installable', 'all', 'webui', 'manual'] as const).map(value => (
                      <button key={value} type="button" aria-pressed={filter === value} data-active={filter === value ? '' : undefined} onClick={() => { setFilter(value) }}>
                        {t[value]}
                      </button>
                    ))}
                  </div>
                  <label className="sort-control"><span className="sr-only">{t.sortLabel}</span>
                    <select aria-label={t.sortLabel} value={sort} onChange={event => { setSort(event.target.value as Sort) }}>
                      <option value="score">{t.best}</option>
                      <option value="stars">{t.starsSort}</option>
                      <option value="updated">{t.updated}</option>
                    </select>
                  </label>
                </div>
                <div className="result-line">
                  <span><b>{loading ? '—' : filtered.length}</b> {t.results}</span>
                  {(query.length > 0 || filter !== 'all') && <button type="button" onClick={clear}>{t.clear}</button>}
                </div>
              </div>
              {loading ? <CatalogSkeleton /> : (
                <CatalogList language={language} filtered={filtered} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMobileOpen(true) }} onClear={clear} />
              )}
            </div>
            {loading ? <DetailSkeleton /> : <Detail entry={active} language={language} mobileOpen={mobileOpen} onBack={() => { setMobileOpen(false) }} />}
          </div>
        )}
      </div>
    </section>
  )
}

function TrustStrip({ language }: { readonly language: Language }): React.ReactElement {
  const t = copy[language]
  return (
    <section className="trust-strip">
      <p className="section-kicker"><ShieldCheck />{t.trustKicker}</p>
      <h2>{t.trustTitle}</h2>
      <p>{t.trustBody}</p>
    </section>
  )
}

export function App(): React.ReactElement {
  const [language, setLanguage] = useState<Language>(() => navigator.language.toLocaleLowerCase().startsWith('zh') ? 'zh' : 'en')
  const t = copy[language]
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en' }, [language])

  return (
    <IconContext.Provider value={{ size: 18, weight: 'regular', mirrored: false }}>
      <div className="site-frame">
        <AppHeader language={language} setLanguage={setLanguage} />
        <main>
          <Hero language={language} />
          <MarketPreview language={language} />
          <TrustStrip language={language} />
        </main>
        <footer>
          <a href="#top"><Brand compact /></a>
          <p>{t.footer}</p>
          <div><a href="https://github.com/NanmiCoder/dsh-plugin-market">GitHub</a><a href="https://www.npmjs.com/package/@nanmicoder/dsh-plugin-market">npm</a></div>
        </footer>
      </div>
    </IconContext.Provider>
  )
}
