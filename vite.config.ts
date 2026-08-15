import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

interface CatalogEntrySummary {
  readonly tier: 'verified-npm' | 'verified-git' | 'likely-plugin' | 'related'
  readonly hasClient: boolean
  readonly [key: string]: unknown
}

interface CatalogSummarySource {
  readonly meta: { readonly count: number, readonly generatedAt: string }
  readonly entries: readonly CatalogEntrySummary[]
}

const catalog = JSON.parse(
  readFileSync(new URL('./data/v1/catalog.json', import.meta.url), 'utf8'),
) as CatalogSummarySource

const npmCount = catalog.entries.filter(entry => entry.tier === 'verified-npm').length
const gitCount = catalog.entries.filter(entry => entry.tier === 'verified-git').length

export default defineConfig({
  root: resolve(import.meta.dirname, 'site'),
  publicDir: resolve(import.meta.dirname, 'assets/readme'),
  define: {
    __CATALOG_STATS__: JSON.stringify({
      total: catalog.meta.count,
      oneClick: npmCount + gitCount,
      npm: npmCount,
      git: gitCount,
      webUi: catalog.entries.filter(entry => entry.hasClient).length,
      generatedAt: catalog.meta.generatedAt,
    }),
    __PREVIEW_ENTRIES__: JSON.stringify(catalog.entries.slice(0, 60)),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'site-dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
