import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

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

const DATA_DIR = resolve(import.meta.dirname, 'data/v1')

/**
 * Serve the catalog as a document, not a bundle constant.
 *
 * index.json is several MB — inlining it via `define` would ship it inside the
 * JS bundle on every deploy, so the site fetches /v1/index.json at runtime
 * instead. In dev the middleware below answers straight from data/v1; for the
 * production build the same two files are copied into site-dist/v1, which also
 * makes the deployed site usable as a registry endpoint.
 */
function catalogData(): Plugin {
  const files = new Set(['index.json', 'meta.json'])
  return {
    name: 'catalog-data',
    configureServer(server) {
      server.middlewares.use('/v1', (request, response) => {
        const name = (request.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? ''
        if (!files.has(name)) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(readFileSync(resolve(DATA_DIR, name)))
      })
    },
    closeBundle() {
      const out = resolve(import.meta.dirname, 'site-dist/v1')
      mkdirSync(out, { recursive: true })
      for (const name of files) copyFileSync(resolve(DATA_DIR, name), resolve(out, name))
    },
  }
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'site'),
  publicDir: resolve(import.meta.dirname, 'assets/readme'),
  plugins: [catalogData()],
  define: {
    __CATALOG_STATS__: JSON.stringify({
      total: catalog.meta.count,
      oneClick: npmCount + gitCount,
      npm: npmCount,
      git: gitCount,
      webUi: catalog.entries.filter(entry => entry.hasClient).length,
      generatedAt: catalog.meta.generatedAt,
    }),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'site-dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
