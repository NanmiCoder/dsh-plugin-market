/** Plugin marketplace tab, registered into Web Settings > Plugins. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Module-loading import: the tab occupies a slot whose contract lives in the
// ui-settings package, and `declare module` only merges into a module the
// program has actually loaded.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { fetchCatalog, installEntry, refreshCatalog, uninstallEntry } from './api.ts'
import { en, zh, type PluginHubLocaleKey } from './locales.ts'
import { MarketTab, type MarketTabInjected } from './MarketTab.tsx'

export type { MarketTabInjected, MarketTabProps } from './MarketTab.tsx'
export type { PluginHubLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin marketplace copy. */
    'settings.pluginHub': PluginHubLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginHub'

/** Services required to contribute a Settings tab. */
export const inject = ['slots', 'locale']

/**
 * Contribute the marketplace tab to the Plugins settings section.
 * @param ctx - the browser-side plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-hub: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): MarketTabInjected => ({
    load: fetchCatalog,
    refresh: refreshCatalog,
    install: installEntry,
    uninstall: uninstallEntry,
    // A newly installed plugin's browser bundle only enters the boot manifest
    // on the next document request: the client HMR channel deliberately
    // ignores graph frames, so nothing would pick it up in place.
    reload: () => { window.location.reload() },
  })

  // `settings.section`, not `settings.plugins.tab`: the Plugins section (and
  // the tab slot inside it) exists only in newer DSH builds, and registering
  // into a slot no host renders means the marketplace silently never appears.
  // `settings.section` is present in every build that ships Settings at all,
  // and gives the marketplace its own nav entry beside General and Models.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugin-hub',
    // After General (0) and Models, so the built-in pages keep their order.
    order: 40,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, MarketTab))
}
