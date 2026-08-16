import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Lang = 'zh' | 'en'
type Tier = 'verified-npm' | 'verified-git' | 'likely-plugin' | 'related'
type TierFilter = Tier | 'all' | 'oneclick'
type SortKey = 'score' | 'stars' | 'fresh'

interface InstallHint {
  readonly method?: string
  readonly command?: string
}

interface CatalogEntry {
  readonly id: string
  readonly repo: string
  readonly owner: string
  readonly url: string
  readonly tier: Tier
  readonly packageName?: string
  readonly installMethod: 'npm' | 'git' | 'manual'
  readonly installSpec?: string
  readonly runsBuildScript: boolean
  readonly manualSteps?: readonly string[]
  readonly installHint?: InstallHint
  readonly description: string
  readonly summary?: string
  readonly summaryEn?: string
  readonly category?: string
  readonly tags: readonly string[]
  readonly topics: readonly string[]
  readonly stars: number
  readonly forks: number
  readonly openIssues: number
  readonly closedIssues: number
  readonly openPullRequests: number
  readonly commits: number
  readonly pushedAt: string
  readonly createdAt: string
  readonly license?: string
  readonly language?: string
  readonly latestReleaseTag?: string
  readonly npmVersion?: string
  readonly hasClient: boolean
  readonly hasSkills: boolean
  readonly needsApiKey: boolean
  readonly score: number
}

type Pair = readonly [string, string]

const CATS: Record<string, Pair> = {
  'ui-experience': ['界面体验', 'UI & experience'],
  'agent-orchestration': ['智能体编排', 'Agent orchestration'],
  'media-image': ['图像与多媒体', 'Media & image'],
  'search-knowledge': ['搜索与知识', 'Search & knowledge'],
  'devops-infra': ['运维与基建', 'DevOps & infra'],
  'data-analysis': ['数据分析', 'Data analysis'],
  communication: ['通讯', 'Communication'],
  productivity: ['效率', 'Productivity'],
  other: ['其他', 'Other'],
}

const CAPS: Record<string, Pair> = {
  'has-web-ui': ['含界面', 'Has web UI'],
  skills: ['含 Skills', 'Ships skills'],
  'needs-api-key': ['需 API Key', 'Needs API key'],
  memory: ['记忆', 'Memory'],
  'multi-agent': ['多智能体', 'Multi-agent'],
  'web-search': ['联网搜索', 'Web search'],
  'mcp-bridge': ['MCP 桥接', 'MCP bridge'],
  'cli-companion': ['CLI 伴侣', 'CLI companion'],
  ocr: ['OCR', 'OCR'],
  'file-ops': ['文件操作', 'File ops'],
}

const FEAT: Record<string, Pair> = {
  'has-web-ui': ['在 Web UI 中挂载独立面板', 'Mounts its own panel in the web UI'],
  skills: ['附带可直接调用的 Agent Skills', 'Ships agent skills the model can call directly'],
  'needs-api-key': ['需要配置第三方 API Key', 'Requires a third-party API key'],
  memory: ['跨会话保留上下文与结论', 'Keeps context and conclusions across sessions'],
  'multi-agent': ['支持子代理并行编排', 'Orchestrates subagents in parallel'],
  subagent: ['可派发独立子代理任务', 'Dispatches standalone subagent tasks'],
  'web-search': ['联网检索并返回带引用的结果', 'Searches the web and returns cited results'],
  'web-scrape': ['抓取单页正文并结构化', 'Fetches and structures single-page content'],
  'mcp-bridge': ['桥接 MCP 服务器与工具', 'Bridges MCP servers and their tools'],
  'cli-companion': ['提供配套 CLI 命令', 'Adds companion CLI commands'],
  ocr: ['识别图片中的文字与版面', 'Recognises text and layout inside images'],
  'image-edit': ['在会话中预览与编辑图像', 'Previews and edits images in the conversation'],
  'file-ops': ['读写工作区文件', 'Reads and writes workspace files'],
  'slash-command': ['注册可直接输入的斜杠命令', 'Registers slash commands you can type'],
  shell: ['执行受控的 shell 命令', 'Runs shell commands under guard'],
  theme: ['替换界面主题与样式', 'Re-skins the interface'],
  monitoring: ['采集运行指标并可视化', 'Collects and visualises runtime metrics'],
  debug: ['提供调试视图与日志回放', 'Adds debug views and log replay'],
  'needs-local-service': ['依赖本机后台服务', 'Depends on a local background service'],
  'needs-browser': ['需要本地浏览器内核', 'Needs a local browser runtime'],
  'browser-automation': ['驱动浏览器完成自动化操作', 'Drives a browser for automation'],
  'plugin-manager': ['管理其他插件的启停与清理', 'Manages other plugins and their removal'],
  'knowledge-graph': ['构建可检索的知识图谱', 'Builds a searchable knowledge graph'],
  'im-bot': ['对接 IM 通道收发消息', 'Connects to IM channels to send and receive'],
  sql: ['本地 SQL 存储与查询', 'Local SQL storage and querying'],
  ssh: ['通过 SSH 连接远程主机', 'Reaches remote hosts over SSH'],
  headless: ['支持无界面/无人值守运行', 'Runs headless and unattended'],
  'prompt-engineering': ['注入可复用的提示词模板', 'Injects reusable prompt templates'],
  experimental: ['接口仍在快速变化中', 'Interfaces are still changing fast'],
}

interface TierStyle {
  readonly zh: string
  readonly en: string
  readonly bg: string
  readonly fg: string
  readonly bd: string
}

const TIERS: Record<Tier, TierStyle> = {
  'verified-npm': { zh: 'npm 已验证', en: 'Verified on npm', bg: 'var(--ds-teal-100)', fg: 'var(--ds-teal)', bd: 'var(--ds-teal-300)' },
  'verified-git': { zh: '源码已验证', en: 'Verified from source', bg: 'var(--ds-blue-100)', fg: 'var(--ds-blue-600)', bd: 'var(--ds-blue-300)' },
  'likely-plugin': { zh: '疑似插件', en: 'Likely plugin', bg: 'var(--ds-elev)', fg: 'var(--ds-ink-800)', bd: 'var(--ds-line)' },
  related: { zh: '生态相关', en: 'Related', bg: 'transparent', fg: 'var(--ds-ink-600)', bd: 'var(--ds-ink-400)' },
}

const T = {
  zh: {
    brand: '插件市场', searchPh: '搜索仓库、包名、分类或标签…', getMarket: '安装本市场', clear: '清空筛选', installed: '已安装',
    manualOnly: '手动安装', emptyTitle: '没有匹配的插件',
    emptyBody: '试试放宽筛选条件，或者只搜索仓库名的一部分——目录里还有 {total} 个条目等着被翻出来。',
    aiSummary: 'AI 摘要', willRun: '将执行的命令', authorHint: '作者 README 里写的', notExecuted: '不会执行', metrics: '仓库指标',
    catTags: '分类与标签', topics: '仓库话题', install: '安装', copied: '已复制', copyFailed: '剪贴板不可用，请手动复制。',
    backList: '返回目录', readmeMeta: '由市场抓取并缓存', sortScore: '按评分', sortStars: '按 Star', sortFresh: '按更新',
    fTier: '安装能力', fCap: '能力标签', fCat: '分类', all: '全部', oneClick: '可一键安装', results: '个结果',
    errorTitle: '插件目录加载失败', errorBody: '目录数据获取失败，请检查网络连接后刷新重试。',
    loading: '目录加载中',
  },
  en: {
    brand: 'Plugin Market', searchPh: 'Search repos, packages, categories or tags…', getMarket: 'Install this market', clear: 'Clear filters', installed: 'Installed',
    manualOnly: 'Manual only', emptyTitle: 'Nothing matches yet',
    emptyBody: 'Loosen a filter, or search just part of a repository name — there are {total} entries in the catalog waiting to be dug out.',
    aiSummary: 'AI summary', willRun: 'Command that will run', authorHint: 'What the author wrote in the README', notExecuted: 'never executed', metrics: 'Repository metrics',
    catTags: 'Category & tags', topics: 'Repository topics', install: 'Install', copied: 'Copied', copyFailed: 'Clipboard unavailable — copy it manually.',
    backList: 'Back to catalog', readmeMeta: 'fetched and cached by the market', sortScore: 'By score', sortStars: 'By stars', sortFresh: 'By updated',
    fTier: 'Install path', fCap: 'Capability', fCat: 'Category', all: 'All', oneClick: 'One-click', results: 'results',
    errorTitle: 'The catalog failed to load', errorBody: 'The catalog could not be fetched. Check your connection and reload the page.',
    loading: 'Loading catalog',
  },
} as const

const stats = __CATALOG_STATS__
const repoUrl = 'https://github.com/NanmiCoder/dsh-plugin-market'
const marketCommand = 'dsh plugin --profile web add @nanmicoder/dsh-plugin-market'
const INSTALLED_KEY = 'dsh-market-installed'
/** Cards per page; the next page loads when the sentinel scrolls into view. */
const PAGE_SIZE = 60

function pair(pairValue: Pair | undefined, lang: Lang, fallback: string): string {
  if (pairValue === undefined) return fallback
  return lang === 'en' ? pairValue[1] : pairValue[0]
}

function entryName(entry: CatalogEntry): string {
  return entry.repo.split('/')[1] ?? entry.repo
}

function monoLetter(entry: CatalogEntry): string {
  const name = entryName(entry)
  const stripped = name.replace(/^dsh[-_]?/i, '')
  return (stripped.charAt(0) || name.charAt(0) || '?').toUpperCase()
}

function canInstall(entry: CatalogEntry): boolean {
  return (entry.tier === 'verified-npm' || entry.tier === 'verified-git') && entry.installSpec !== undefined && entry.installSpec.length > 0
}

function installCommand(entry: CatalogEntry): string | undefined {
  if (!canInstall(entry)) return undefined
  return `dsh plugin --profile web add ${entry.installSpec ?? ''}`
}

function fmtCompact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function fmtThousands(value: number): string {
  return value.toLocaleString('en-US')
}

function relDate(iso: string, lang: Lang): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000))
  if (lang === 'zh') return days === 0 ? '今天' : `${days} 天前`
  return days === 0 ? 'today' : `${days}d ago`
}

function summaryOf(entry: CatalogEntry, lang: Lang): string {
  if (lang === 'en') return entry.summaryEn ?? entry.summary ?? entry.description
  return entry.summary ?? entry.description
}

function matches(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  const hay = [
    entry.id, entry.repo, entry.packageName ?? '', entry.description,
    entry.summary ?? '', entry.summaryEn ?? '', entry.category ?? '',
    entry.tags.join(' '), entry.topics.join(' '),
  ].join(' ').toLowerCase()
  return hay.includes(q)
}

function loadInstalled(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(INSTALLED_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return {}
    const map: Record<string, true> = {}
    for (const id of parsed) if (typeof id === 'string') map[id] = true
    return map
  } catch {
    return {}
  }
}

function saveInstalled(map: Record<string, true>): void {
  try {
    window.localStorage.setItem(INSTALLED_KEY, JSON.stringify(Object.keys(map)))
  } catch {
    // storage unavailable — installed pills just won't persist
  }
}

// — inline icons (Lucide paths, 24 viewBox) —

interface IconProps {
  readonly size?: number
  readonly className?: string
  readonly strokeWidth?: number
}

function IconBase({ size = 16, className, strokeWidth = 2.75, children }: IconProps & { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  )
}

function ShieldIcon(props: IconProps): React.ReactElement {
  return <IconBase {...props}><path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></IconBase>
}

function SearchIcon(props: IconProps): React.ReactElement {
  return <IconBase {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></IconBase>
}

function ExternalIcon(props: IconProps): React.ReactElement {
  return <IconBase {...props}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></IconBase>
}

function XIcon(props: IconProps): React.ReactElement {
  return <IconBase strokeWidth={3} {...props}><path d="M18 6 6 18M6 6l12 12" /></IconBase>
}

function BackIcon(props: IconProps): React.ReactElement {
  return <IconBase strokeWidth={3} {...props}><path d="m15 18-6-6 6-6" /></IconBase>
}

function StarIcon(props: IconProps): React.ReactElement {
  return (
    <svg width={props.size ?? 13} height={props.size ?? 13} viewBox="0 0 24 24" fill="var(--ds-blue-200)" stroke="var(--ds-blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9z" />
    </svg>
  )
}

function FileIcon(props: IconProps): React.ReactElement {
  return <IconBase strokeWidth={2.5} {...props}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></IconBase>
}

function CheckIcon(props: IconProps): React.ReactElement {
  return <IconBase strokeWidth={3} {...props}><path d="M20 6 9 17l-5-5" /></IconBase>
}

function InfoIcon(props: IconProps): React.ReactElement {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></IconBase>
}

// — background layer —

function Background(): React.ReactElement {
  return (
    <div className="bg-layer" aria-hidden="true">
      <div className="bg-halo bg-halo-a" />
      <div className="bg-halo bg-halo-b" />
    </div>
  )
}

// — header —

function Header({ lang, setLang }: {
  readonly lang: Lang
  readonly setLang: (lang: Lang) => void
}): React.ReactElement {
  const t = T[lang]
  return (
    <header className="site-header">
      <div className="brand">
        <span className="brand-logo"><ShieldIcon size={18} /></span>
        <span className="brand-name">{t.brand}</span>
      </div>
      <div className="header-side">
        <div className="seg" role="group" aria-label="Language">
          <button type="button" className="seg-btn" data-on={lang === 'zh' ? '' : undefined} aria-pressed={lang === 'zh'} onClick={() => { setLang('zh') }}>中文</button>
          <button type="button" className="seg-btn" data-on={lang === 'en' ? '' : undefined} aria-pressed={lang === 'en'} onClick={() => { setLang('en') }}>EN</button>
        </div>
        <a className="gh-link" href={repoUrl} target="_blank" rel="noreferrer">
          <ExternalIcon size={15} />
          GitHub
        </a>
      </div>
    </header>
  )
}

// — search —

function SearchPill({ lang, query, setQuery }: {
  readonly lang: Lang
  readonly query: string
  readonly setQuery: (query: string) => void
}): React.ReactElement {
  const t = T[lang]
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <label className="search-pill">
      <SearchIcon size={17} className="search-icon" />
      <input
        ref={searchRef}
        value={query}
        onChange={event => { setQuery(event.target.value) }}
        placeholder={t.searchPh}
        type="search"
        aria-label={t.searchPh}
      />
      <kbd className="kbd">⌘K</kbd>
    </label>
  )
}

// — filter rail —

interface FacetOption {
  readonly key: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly pick: () => void
}

function FacetGroup({ label, options }: { readonly label: string, readonly options: readonly FacetOption[] }): React.ReactElement {
  return (
    <div className="facet">
      <div className="facet-label">{label}</div>
      {options.map(option => (
        <button key={option.key} type="button" className="pill" data-on={option.active ? '' : undefined} aria-pressed={option.active} onClick={option.pick}>
          <span className="pill-label">{option.label}</span>
          <span className="pill-count">{option.count}</span>
        </button>
      ))}
    </div>
  )
}

// — install / copy button —

function InstallButton({ entry, lang, big, installed, onCopied, onManual }: {
  readonly entry: CatalogEntry
  readonly lang: Lang
  readonly big?: boolean
  readonly installed: boolean
  readonly onCopied: (id: string) => void
  readonly onManual: () => void
}): React.ReactElement {
  const t = T[lang]
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => { window.clearTimeout(timer.current) }, [])

  const command = installCommand(entry)

  if (command === undefined) {
    return (
      <button type="button" className={big === true ? 'btn-ghost btn-big' : 'btn-ghost'} onClick={(event) => { event.stopPropagation(); onManual() }}>
        {t.manualOnly}
      </button>
    )
  }

  const copy = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      // clipboard unavailable (non-secure context) — fall back to a hidden textarea
      const area = document.createElement('textarea')
      area.value = command
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    onCopied(entry.id)
    timer.current = window.setTimeout(() => { setCopied(false) }, 2000)
  }

  return (
    <button
      type="button"
      className={big === true ? 'btn-primary btn-big' : 'btn-primary'}
      data-copied={copied ? '' : undefined}
      data-installed={!copied && installed ? '' : undefined}
      onClick={(event) => { void copy(event) }}
    >
      {copied && <CheckIcon size={13} />}
      {copied ? t.copied : t.install}
    </button>
  )
}

// — plugin card —

function PluginCard({ entry, lang, installed, onOpen, onCopied }: {
  readonly entry: CatalogEntry
  readonly lang: Lang
  readonly installed: boolean
  readonly onOpen: () => void
  readonly onCopied: (id: string) => void
}): React.ReactElement {
  const t = T[lang]
  const tier = TIERS[entry.tier]
  const name = entryName(entry)
  const chips = [pair(CATS[entry.category ?? 'other'] ?? CATS.other, lang, entry.category ?? 'other')]
    .concat(entry.tags.slice(0, 3).map(tag => pair(CAPS[tag], lang, tag)))

  return (
    <article className="card" tabIndex={0} role="button" onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}>
      <div className="card-head">
        <div className="mono" style={{ background: tier.bg === 'transparent' ? 'var(--ds-elev)' : tier.bg, color: tier.fg, borderColor: tier.bd }}>{monoLetter(entry)}</div>
        <div className="card-titles">
          <div className="card-name">{name}</div>
          <div className="card-sub">{entry.packageName ?? entry.id}</div>
        </div>
        <div className="star-block">
          <div className="star-num"><StarIcon size={14} />{fmtCompact(entry.stars)}</div>
          <div className="star-label">stars</div>
        </div>
      </div>

      <div className="badge-row">
        <span className="tier-pill" style={{ background: tier.bg, color: tier.fg, borderColor: tier.bd }}>
          <span className="tier-dot" style={{ background: tier.fg }} />{lang === 'en' ? tier.en : tier.zh}
        </span>
        {installed && <span className="installed-pill">{t.installed}</span>}
      </div>

      <div className="card-summary">{summaryOf(entry, lang)}</div>

      <div className="chip-row">
        {chips.map(chip => <span key={chip} className="chip">{chip}</span>)}
      </div>

      <div className="card-foot">
        <span className="foot-item">{entry.license ?? '—'}</span>
        <span className="foot-item">{relDate(entry.pushedAt, lang)}</span>
        <span className="foot-action">
          <InstallButton entry={entry} lang={lang} installed={installed} onCopied={onCopied} onManual={onOpen} />
        </span>
      </div>
    </article>
  )
}

// — synthesized README blocks —

type Block =
  | { readonly kind: 'h2' | 'p' | 'li' | 'code' | 'note', readonly text: string }

function readmeBlocks(entry: CatalogEntry, lang: Lang): Block[] {
  const zh = lang !== 'en'
  const blocks: Block[] = []
  const name = entryName(entry)
  const installable = canInstall(entry)

  blocks.push({ kind: 'p', text: entry.description })

  blocks.push({ kind: 'h2', text: zh ? '功能特性' : 'Features' })
  const feats = entry.tags.filter(tag => FEAT[tag] !== undefined).slice(0, 5)
  const featTags = feats.length > 0 ? feats : ['file-ops']
  for (const tag of featTags) {
    const feat = FEAT[tag]
    if (feat !== undefined) blocks.push({ kind: 'li', text: zh ? feat[0] : feat[1] })
  }

  blocks.push({ kind: 'h2', text: zh ? '安装' : 'Installation' })
  if (entry.tier === 'verified-npm') {
    const pkg = entry.packageName ?? entry.installSpec ?? entry.repo
    const version = entry.npmVersion !== undefined && entry.npmVersion.length > 0 ? `@${entry.npmVersion}` : ''
    blocks.push({
      kind: 'code',
      text: `# ${zh ? '在 Web 配置里安装' : 'install into the web profile'}\n$ dsh plugin --profile web add ${pkg}\n\n# ${zh ? '或手动加入依赖' : 'or add it manually'}\n$ pnpm add ${pkg}${version}`,
    })
  } else if (entry.tier === 'verified-git') {
    blocks.push({
      kind: 'code',
      text: `$ pnpm add ${entry.installSpec ?? entry.url}\n# ${zh ? '安装时会执行仓库的构建脚本' : 'the repository build script runs on install'}`,
    })
  } else {
    blocks.push({ kind: 'code', text: `$ git clone https://github.com/${entry.repo}\n$ cd ${name} && pnpm i && pnpm build` })
    blocks.push({
      kind: 'note',
      text: zh
        ? '该条目没有可验证的无人值守安装路径，市场不提供一键安装按钮，请按上面的步骤手动构建。'
        : 'This entry has no provable unattended install path, so the market offers no one-click button — build it manually with the steps above.',
    })
  }

  blocks.push({ kind: 'h2', text: zh ? '使用' : 'Usage' })
  if (entry.tags.includes('slash-command')) {
    blocks.push({ kind: 'code', text: `/${name.replace(/^dsh[-_]?/, '')} ${zh ? '<你的指令>' : '<your instruction>'}` })
    blocks.push({
      kind: 'p',
      text: zh
        ? '安装后在对话框直接输入斜杠命令；也可以让模型在需要时自行调用对应工具。'
        : 'Type the slash command in the composer after installing, or let the model call the matching tool when it needs to.',
    })
  } else if (entry.hasClient || entry.tags.includes('has-web-ui')) {
    blocks.push({
      kind: 'p',
      text: zh
        ? '安装并刷新页面后，插件会在 Web UI 中出现自己的入口，无需额外配置即可使用。'
        : 'After installing and reloading the page, the plugin adds its own entry point to the web UI — no extra configuration needed.',
    })
  } else {
    blocks.push({
      kind: 'p',
      text: zh
        ? '安装后插件会自动注册到宿主，模型在需要时会调用它暴露的工具。'
        : 'Once installed the plugin registers with the host, and the model calls the tools it exposes when relevant.',
    })
  }

  if (entry.needsApiKey) {
    blocks.push({ kind: 'h2', text: zh ? '配置' : 'Configuration' })
    const envName = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    blocks.push({ kind: 'code', text: `${envName}_API_KEY=sk-...\n${envName}_BASE_URL=https://api.example.com/v1` })
    blocks.push({
      kind: 'p',
      text: zh
        ? '把上面的变量写进宿主的环境变量或插件设置面板；Key 只保存在本机。'
        : 'Put these in the host environment or the plugin settings panel — the key stays on your machine.',
    })
  }

  blocks.push({ kind: 'h2', text: zh ? '许可与来源' : 'License & provenance' })
  blocks.push({ kind: 'li', text: `${zh ? '许可证：' : 'License: '}${entry.license ?? '—'} · ${zh ? '主要语言：' : 'Language: '}${entry.language ?? '—'}` })
  blocks.push({ kind: 'li', text: `${zh ? '最近更新：' : 'Last updated: '}${relDate(entry.pushedAt, lang)} · ${entry.commits}${zh ? ' 次提交' : ' commits'}` })
  if (installable && entry.npmVersion !== undefined && entry.npmVersion.length > 0) {
    blocks.push({ kind: 'li', text: `${zh ? 'npm 最新版本：' : 'Latest npm version: '}${entry.npmVersion}` })
  }
  return blocks
}

// — detail view —

function DetailView({ entry, lang, installed, onBack, onCopied }: {
  readonly entry: CatalogEntry
  readonly lang: Lang
  readonly installed: boolean
  readonly onBack: () => void
  readonly onCopied: (id: string) => void
}): React.ReactElement {
  const t = T[lang]
  const zh = lang !== 'en'
  const tier = TIERS[entry.tier]
  const name = entryName(entry)
  const installable = canInstall(entry)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onBack])

  const evidence = entry.tier === 'verified-npm'
    ? (zh ? 'npm 清单声明了 dsh.bundle' : 'npm manifest declares dsh.bundle')
    : entry.tier === 'verified-git'
      ? (zh ? '仓库声明 dsh.bundle 且 cordis.patch.yml 有效（安装时会构建）' : 'Repo declares dsh.bundle + valid cordis.patch.yml (build runs on install)')
      : (zh ? '无法证明可无人值守安装' : 'No provable unattended install path')

  const spec = installable
    ? (entry.installSpec ?? '')
    : (zh ? '— 市场不提供一键安装' : '— not installable from the marketplace')

  const reloadNote = entry.hasClient
    ? (zh ? '含 Web 界面，安装后刷新页面即可生效。' : 'Ships a web UI — reload the page after installing.')
    : (zh ? '仅宿主端插件，安装后立即热挂载。' : 'Host-only plugin — hot-mounts immediately.')

  const metrics: ReadonlyArray<{ readonly k: string, readonly v: string }> = [
    { k: 'Star', v: fmtCompact(entry.stars) },
    { k: 'Fork', v: String(entry.forks) },
    { k: zh ? '提交' : 'Commits', v: String(entry.commits) },
    { k: zh ? '开放 Issue' : 'Open issues', v: String(entry.openIssues) },
    { k: zh ? '已关闭' : 'Closed', v: String(entry.closedIssues) },
    { k: zh ? '开放 PR' : 'Open PR', v: String(entry.openPullRequests) },
    { k: zh ? '许可证' : 'License', v: entry.license ?? '—' },
    { k: zh ? '主要语言' : 'Language', v: entry.language ?? '—' },
    { k: zh ? 'npm 版本' : 'npm version', v: entry.npmVersion ?? '—' },
    { k: zh ? '创建于' : 'Created', v: entry.createdAt.slice(0, 10) },
    { k: zh ? '更新于' : 'Updated', v: relDate(entry.pushedAt, lang) },
  ]

  const chips = [pair(CATS[entry.category ?? 'other'] ?? CATS.other, lang, entry.category ?? 'other')]
    .concat(entry.tags.map(tag => pair(CAPS[tag], lang, tag)))

  const blocks = readmeBlocks(entry, lang)

  return (
    <div className="detail">
      <button type="button" className="back-btn" onClick={onBack}>
        <BackIcon size={13} />{t.backList}
      </button>

      <header className="detail-head">
        <div className="mono mono-big" style={{ background: tier.bg === 'transparent' ? 'var(--ds-elev)' : tier.bg, color: tier.fg, borderColor: tier.bd }}>{monoLetter(entry)}</div>
        <div className="detail-titles">
          <div className="detail-name-row">
            <span className="detail-name">{name}</span>
            <span className="tier-pill" style={{ background: tier.bg, color: tier.fg, borderColor: tier.bd }}>
              <span className="tier-dot" style={{ background: tier.fg }} />{lang === 'en' ? tier.en : tier.zh}
            </span>
            {installed && <span className="installed-pill">{t.installed}</span>}
          </div>
          <a className="repo-link" href={entry.url} target="_blank" rel="noreferrer">
            {entry.repo}
            <ExternalIcon size={12} />
          </a>
          <div className="ai-summary">
            <span className="ai-label">{t.aiSummary}</span>
            <span className="ai-text">{summaryOf(entry, lang)}</span>
          </div>
        </div>
        <div className="detail-side">
          <div className="star-block">
            <div className="star-num star-big"><StarIcon size={18} />{fmtCompact(entry.stars)}</div>
            <div className="star-label">stars</div>
          </div>
          <InstallButton entry={entry} lang={lang} big installed={installed} onCopied={onCopied} onManual={() => undefined} />
        </div>
      </header>

      <div className="detail-body">
        <main className="readme-panel">
          <div className="readme-bar">
            <FileIcon size={15} className="readme-file-icon" />
            <span className="readme-title">README.md</span>
            <span className="readme-meta">{t.readmeMeta}</span>
          </div>
          <div className="readme-body">
            {blocks.map((block, index) => {
              if (block.kind === 'h2') {
                return <div key={index} className="rm-h2"><span className="rm-h2-bar" /><span>{block.text}</span></div>
              }
              if (block.kind === 'p') return <div key={index} className="rm-p">{block.text}</div>
              if (block.kind === 'li') {
                return <div key={index} className="rm-li"><CheckIcon size={15} className="rm-li-icon" /><span>{block.text}</span></div>
              }
              if (block.kind === 'code') return <div key={index} className="rm-code">{block.text}</div>
              return <div key={index} className="rm-note"><InfoIcon size={15} className="rm-note-icon" /><span>{block.text}</span></div>
            })}
          </div>
        </main>

        <aside className="detail-rail">
          <div className="side-card">
            <div className="evidence-line">
              <ShieldIcon size={15} className="evidence-icon" />
              <span className="evidence-text">{evidence}</span>
            </div>
            <div className="side-label">{t.willRun}</div>
            <div className="term-block">$ pnpm add {spec}</div>
            <span className="side-note">{reloadNote}</span>
          </div>

          <div className="side-card">
            <div className="side-label">{t.authorHint}</div>
            <div className="hint-text">{entry.installHint === undefined || entry.installHint.command === '' ? '—' : entry.installHint.command}</div>
            <span className="hint-badge">{t.notExecuted}</span>
          </div>

          <div className="side-card">
            <div className="side-label">{t.metrics}</div>
            <div className="metrics-grid">
              {metrics.map(metric => (
                <div key={metric.k} className="metric">
                  <div className="metric-k">{metric.k}</div>
                  <div className="metric-v">{metric.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="side-card">
            <div className="side-label">{t.catTags}</div>
            <div className="chip-row">
              {chips.map(chip => <span key={chip} className="chip chip-lg">{chip}</span>)}
            </div>
            <div className="side-label side-label-gap">{t.topics}</div>
            <div className="chip-row">
              {entry.topics.length > 0
                ? entry.topics.map(topic => <span key={topic} className="topic-pill">{topic}</span>)
                : <span className="topic-pill">—</span>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

// — skeletons & empty states —

function SkeletonCards(): React.ReactElement {
  return (
    <div className="grid" aria-busy="true" aria-label="Loading catalog">
      {Array.from({ length: 9 }, (_, index) => (
        <div className="card skeleton-card" key={index}>
          <div className="card-head">
            <span className="skeleton-block skeleton-mono" />
            <span className="skeleton-lines">
              <span className="skeleton-line skeleton-w60" />
              <span className="skeleton-line skeleton-w40" />
            </span>
          </div>
          <span className="skeleton-line skeleton-w30" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-w80" />
        </div>
      ))}
    </div>
  )
}

// — app —

export function App(): React.ReactElement {
  const [lang, setLang] = useState<Lang>(() => navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en')
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<TierFilter>('all')
  const [cap, setCap] = useState('all')
  const [cat, setCat] = useState('all')
  const [sort, setSort] = useState<SortKey>('stars')
  const [selId, setSelId] = useState<string | undefined>(() => {
    // Deep link: `?e=<entry-id>` opens straight into the detail view.
    const id = new URLSearchParams(window.location.search).get('e')
    return id === null || id === '' ? undefined : id
  })
  const [installed, setInstalled] = useState<Record<string, true>>(loadInstalled)
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const t = T[lang]

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  // The catalog is fetched at runtime: at several MB it has no business being
  // inlined into the bundle, and serving /v1/index.json doubles as the public
  // registry document. The empty-entries-plus-not-loading state below is the
  // fetch-failure UI.
  useEffect(() => {
    let cancelled = false
    fetch('/v1/index.json')
      .then(async response => {
        if (!response.ok) throw new Error(`catalog ${response.status}`)
        return await response.json() as { readonly entries: readonly CatalogEntry[] }
      })
      .then(data => { if (!cancelled) { setEntries(data.entries); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Paginate by intersection rather than rendering thousands of cards at once;
  // any filter change starts the page over from the top.
  useEffect(() => { setLimit(PAGE_SIZE) }, [query, tier, cap, cat, sort])
  const listLengthRef = useRef(0)
  const sentinelObserverRef = useRef<IntersectionObserver | undefined>(undefined)
  const observeSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelObserverRef.current?.disconnect()
    sentinelObserverRef.current = undefined
    if (node === null) return
    const observer = new IntersectionObserver(
      hits => {
        if (!hits.some(hit => hit.isIntersecting)) return
        setLimit(current => current < listLengthRef.current ? current + PAGE_SIZE : current)
      },
      { rootMargin: '800px' },
    )
    observer.observe(node)
    sentinelObserverRef.current = observer
  }, [])
  useEffect(() => () => { sentinelObserverRef.current?.disconnect() }, [])

  const markInstalled = (id: string): void => {
    setInstalled(prev => {
      if (prev[id] === true) return prev
      const next = { ...prev, [id]: true as const }
      saveInstalled(next)
      return next
    })
  }

  const list = useMemo(() => {
    let result = entries.filter(entry => matches(entry, query))
    if (tier === 'oneclick') result = result.filter(entry => entry.tier === 'verified-npm' || entry.tier === 'verified-git')
    else if (tier !== 'all') result = result.filter(entry => entry.tier === tier)
    if (cap !== 'all') result = result.filter(entry => entry.tags.includes(cap))
    if (cat !== 'all') result = result.filter(entry => (entry.category ?? 'other') === cat)
    const sorted = [...result]
    if (sort === 'stars') sorted.sort((a, b) => b.stars - a.stars)
    else if (sort === 'fresh') sorted.sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))
    else sorted.sort((a, b) => b.score - a.score)
    return sorted
  }, [cap, cat, entries, query, sort, tier])
  listLengthRef.current = list.length

  const facets = useMemo(() => {
    const count = (fn: (entry: CatalogEntry) => boolean): number => entries.filter(fn).length
    const tierOptions: FacetOption[] = ([
      { key: 'all' as const, label: t.all, count: entries.length },
      { key: 'oneclick' as const, label: t.oneClick, count: count(e => e.tier === 'verified-npm' || e.tier === 'verified-git') },
      ...(['verified-npm', 'verified-git', 'likely-plugin', 'related'] as const).map(key => ({
        key: key as string,
        label: lang === 'en' ? TIERS[key].en : TIERS[key].zh,
        count: count(e => e.tier === key),
      })),
    ]).map(option => ({ ...option, active: tier === option.key, pick: () => { setTier(option.key as TierFilter) } }))
    const capBase: Array<{ key: string, label: string, count: number }> = [{ key: 'all', label: t.all, count: entries.length }]
    for (const key of Object.keys(CAPS)) {
      const n = count(e => e.tags.includes(key))
      if (n > 0) capBase.push({ key, label: pair(CAPS[key], lang, key), count: n })
    }
    const capOptions: FacetOption[] = capBase
      .map(option => ({ ...option, active: cap === option.key, pick: () => { setCap(option.key) } }))
    const catBase: Array<{ key: string, label: string, count: number }> = [{ key: 'all', label: t.all, count: entries.length }]
    for (const key of Object.keys(CATS)) {
      const n = count(e => (e.category ?? 'other') === key)
      if (n > 0) catBase.push({ key, label: pair(CATS[key], lang, key), count: n })
    }
    const catOptions: FacetOption[] = catBase
      .map(option => ({ ...option, active: cat === option.key, pick: () => { setCat(option.key) } }))
    return [
      { label: t.fTier, options: tierOptions },
      { label: t.fCap, options: capOptions },
      { label: t.fCat, options: catOptions },
    ]
  }, [cap, cat, entries, lang, t, tier])

  const hasFilters = query.length > 0 || tier !== 'all' || cap !== 'all' || cat !== 'all'
  const clearAll = (): void => { setQuery(''); setTier('all'); setCap('all'); setCat('all') }
  const headline = query.length > 0
    ? (lang === 'en' ? 'Search results' : '搜索结果')
    : tier === 'oneclick'
      ? (lang === 'en' ? 'One-click installable' : '可一键安装')
      : (lang === 'en' ? 'Featured in the catalog' : '目录精选')

  const selected = selId === undefined ? undefined : entries.find(entry => entry.id === selId)
  const openDetail = (id: string): void => { setSelId(id); window.scrollTo(0, 0) }

  const sorts: ReadonlyArray<{ readonly key: SortKey, readonly label: string }> = [
    { key: 'score', label: t.sortScore },
    { key: 'stars', label: t.sortStars },
    { key: 'fresh', label: t.sortFresh },
  ]

  return (
    <>
      <Background />
      <div className="site-shell">
        <Header lang={lang} setLang={setLang} />
        {selected !== undefined ? (
          <DetailView
            entry={selected}
            lang={lang}
            installed={installed[selected.id] === true}
            onBack={() => { setSelId(undefined) }}
            onCopied={markInstalled}
          />
        ) : (
          <div className="layout">
            <aside className="rail">
              {facets.map(facet => <FacetGroup key={facet.label} label={facet.label} options={facet.options} />)}
              <div className="market-card">
                <div className="market-card-label">{t.getMarket}</div>
                <code>$ {marketCommand}</code>
              </div>
            </aside>
            <main className="main">
              <SearchPill lang={lang} query={query} setQuery={setQuery} />
              <div className="list-head">
                <div className="headline">{headline}</div>
                <div className="result-line">{list.length} {t.results}</div>
                {hasFilters && (
                  <button type="button" className="clear-btn" onClick={clearAll}>
                    <XIcon size={12} />{t.clear}
                  </button>
                )}
                <div className="seg sort-seg" role="group" aria-label="Sort">
                  {sorts.map(option => (
                    <button key={option.key} type="button" className="seg-btn" data-on={sort === option.key ? '' : undefined} aria-pressed={sort === option.key} onClick={() => { setSort(option.key) }}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {entries.length === 0 && !loading ? (
                <div className="empty-state" role="alert">
                  <div className="empty-title">{t.errorTitle}</div>
                  <div className="empty-body">{t.errorBody}</div>
                </div>
              ) : loading ? (
                <SkeletonCards />
              ) : list.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-title">{t.emptyTitle}</div>
                  <div className="empty-body">{t.emptyBody.replace('{total}', fmtThousands(stats.total))}</div>
                  <button type="button" className="btn-primary btn-empty" onClick={clearAll}>{t.clear}</button>
                </div>
              ) : (
                <>
                  <div className="grid">
                    {list.slice(0, limit).map(entry => (
                      <PluginCard
                        key={entry.id}
                        entry={entry}
                        lang={lang}
                        installed={installed[entry.id] === true}
                        onOpen={() => { openDetail(entry.id) }}
                        onCopied={markInstalled}
                      />
                    ))}
                  </div>
                  {limit < list.length && (
                    <div className="load-sentinel" ref={observeSentinel}>
                      {Math.min(limit, list.length)} / {fmtThousands(list.length)}
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </>
  )
}
