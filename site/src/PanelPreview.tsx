/**
 * In-app panel preview (?preview=panel).
 *
 * Renders the real plugin Settings tab — `src/client/MarketTab.tsx`, the exact
 * bundle DSH mounts — inside a mock settings window, with the host contract
 * faked: the injected face resolves against the site's preview catalog, and
 * the shell's `--ds-*` variables are set on a wrapper so the tab's derived
 * neutrals can be exercised in both host themes. It exists so the panel UI
 * can be checked in a browser without booting a DSH host.
 */

import { useEffect, useMemo, useState } from 'react'
import type { CatalogEntryView, CatalogResponse, MutationResponse } from '../../src/types.ts'
// Module-loading imports: `PropsRuntime<'settings.section'>` resolves only
// after the ui-settings package's `declare module` merge has been loaded into
// the program, which the client program gets from src/client/index.tsx.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MarketTab, type MarketTabProps } from '../../src/client/MarketTab.tsx'
import { en as enDict, zh as zhDict, type PluginHubLocaleKey } from '../../src/client/locales.ts'

// Mirror of the locale-namespace merge in src/client/index.tsx: without it the
// site program cannot resolve `PropsLocale<'settings.pluginHub'>` (the `t`
// prop) for the real tab component.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.pluginHub': PluginHubLocaleKey
  }
}

type Language = 'zh' | 'en'
type Theme = 'light' | 'dark'

interface PreviewEntry extends Omit<CatalogEntryView, 'installState'> {
  readonly installState?: CatalogEntryView['installState']
}

/** Host shell variables, light theme — the values the DSH web UI would set. */
const HOST_LIGHT: Record<string, string> = {
  '--ds-text-primary': '#212327',
  '--ds-text-secondary': '#6b7280',
  '--ds-text-tertiary': '#868d9b',
  '--ds-bg-primary': '#ffffff',
  '--ds-bg-secondary': '#f5f7fb',
  '--ds-bg-tertiary': '#eef1f7',
}

/** Host shell variables, dark theme. */
const HOST_DARK: Record<string, string> = {
  '--ds-text-primary': '#eef1f7',
  '--ds-text-secondary': '#a3aab8',
  '--ds-text-tertiary': '#7c8393',
  '--ds-bg-primary': '#1d2026',
  '--ds-bg-secondary': '#16181d',
  '--ds-bg-tertiary': '#282c34',
}

const NAV = [
  { key: 'general', zh: '通用设置', en: 'General' },
  { key: 'models', zh: '模型', en: 'Models' },
  { key: 'plugins', zh: '插件', en: 'Plugins' },
  { key: 'agents', zh: 'Agent 预设', en: 'Agent presets' },
  { key: 'market', zh: '插件市场', en: 'Marketplace' },
] as const

/** The mock settings window hosting the real marketplace tab. */
export function PanelPreview(): React.ReactElement {
  const [language, setLanguage] = useState<Language>('zh')
  const [theme, setTheme] = useState<Theme>('light')
  // The catalog arrives at runtime, same as the marketplace page: several MB
  // of JSON have no place inside the preview bundle either.
  const [sourceEntries, setSourceEntries] = useState<readonly PreviewEntry[]>([])
  // One id is pre-installed so the installed pill, uninstall action and the
  // "Installed" filter pill all have something to show. Seeded once the
  // catalog lands, and never re-seeded over the user's own toggles.
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/v1/index.json')
      .then(async response => {
        if (!response.ok) throw new Error(`catalog ${response.status}`)
        return await response.json() as { readonly entries: readonly PreviewEntry[] }
      })
      .then(data => { if (!cancelled) setSourceEntries(data.entries) })
      .catch(() => { /* the preview simply stays empty */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (sourceEntries.length === 0) return
    setInstalled(previous => previous.size > 0
      ? previous
      : new Set(sourceEntries.slice(0, 120).filter(entry => entry.installMethod !== 'manual').slice(2, 3).map(entry => entry.id)))
  }, [sourceEntries])

  const t = useMemo(() => {
    const dict = language === 'zh' ? zhDict : enDict
    return (key: PluginHubLocaleKey): string => dict[key] ?? key
  }, [language])

  const catalog = useMemo((): CatalogResponse => ({
    entries: sourceEntries.map(entry => ({
      ...entry,
      installState: installed.has(entry.id) ? 'installed' : 'not-installed',
    })),
    meta: {
      schemaVersion: 1,
      generatedAt: __CATALOG_STATS__.generatedAt,
      count: __CATALOG_STATS__.total,
      contentHash: 'preview',
    },
    source: 'remote',
    installEnabled: true,
  }), [installed, sourceEntries])

  const props = useMemo((): MarketTabProps => {
    const mutate = (id: string, add: boolean, name?: string): Promise<MutationResponse> =>
      new Promise((resolve) => {
        window.setTimeout(() => {
          setInstalled(current => {
            const next = new Set(current)
            if (add) next.add(id)
            else next.delete(sourceEntries.find(entry => entry.packageName === name)?.id ?? id)
            return next
          })
          resolve({ ok: true, needsReload: false, message: add ? 'Installed (preview mock)' : 'Uninstalled (preview mock)' })
        }, 700)
      })
    return {
      t,
      load: () => Promise.resolve(catalog),
      refresh: () => Promise.resolve(catalog),
      install: (id: string) => mutate(id, true),
      uninstall: (name: string) => mutate(name, false, name),
      reload: () => { window.location.reload() },
    } as unknown as MarketTabProps
  }, [t, catalog])

  const hostVars = theme === 'light' ? HOST_LIGHT : HOST_DARK

  return (
    <div className="panel-preview" data-theme={theme}>
      <div className="panel-preview-window" style={hostVars as React.CSSProperties}>
        <nav className="panel-preview-nav">
          <div className="panel-preview-title">{language === 'zh' ? '设置' : 'Settings'}</div>
          {NAV.map(item => (
            <div key={item.key} className="panel-preview-navitem" data-active={item.key === 'market' ? '' : undefined}>
              <span className="panel-preview-navdot" aria-hidden="true" />
              {language === 'zh' ? item.zh : item.en}
            </div>
          ))}
          <div className="panel-preview-toggles">
            <div className="panel-preview-seg" role="group" aria-label="Language">
              <button type="button" data-active={language === 'zh' ? '' : undefined} onClick={() => { setLanguage('zh') }}>中文</button>
              <button type="button" data-active={language === 'en' ? '' : undefined} onClick={() => { setLanguage('en') }}>EN</button>
            </div>
            <div className="panel-preview-seg" role="group" aria-label="Host theme">
              <button type="button" data-active={theme === 'light' ? '' : undefined} onClick={() => { setTheme('light') }}>浅色</button>
              <button type="button" data-active={theme === 'dark' ? '' : undefined} onClick={() => { setTheme('dark') }}>深色</button>
            </div>
          </div>
        </nav>
        <section className="panel-preview-content">
          <MarketTab key={`${language}`} {...props} />
        </section>
      </div>
      <p className="panel-preview-note">
        Preview of the real in-DSH tab with a mocked host — installs flip local state only. <a href="/">← Back to the site</a>
      </p>
    </div>
  )
}
