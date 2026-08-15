/**
 * Browser-side access to this plugin's own host routes.
 *
 * Plain `fetch` against a relative path, not a typert Remote: the Remote
 * contribution list the client runtime mounts is a hard-coded array in
 * `@deepseek-ai/dsh-api-remotes`, which an out-of-tree plugin cannot join.
 */

import type { CatalogResponse, MutationResponse, ReadmeResponse } from '../types.ts'

// Not `/plugins/<package-id>`: that prefix is the client-module registry's,
// and registering a route there would shadow this plugin's own browser bundle.
const BASE = '/plugin-hub'

/**
 * Read the catalog joined with local install state.
 * @returns the catalog response.
 * @throws when the host answers with a non-2xx status.
 */
export async function fetchCatalog(): Promise<CatalogResponse> {
  const response = await fetch(`${BASE}/catalog`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`catalog request failed: HTTP ${response.status}`)
  return await response.json() as CatalogResponse
}

/**
 * Force a refresh from the published catalog source.
 * @returns the catalog response after the attempt.
 * @throws when the host answers with a non-2xx status.
 */
export async function refreshCatalog(): Promise<CatalogResponse> {
  const response = await post(`${BASE}/refresh`, {})
  if (!response.ok) throw new Error(`refresh failed: HTTP ${response.status}`)
  return await response.json() as CatalogResponse
}

/**
 * Read one entry's README.
 *
 * As with install, only the id travels: the host resolves the repository from
 * its own catalog rather than fetching a URL this side supplies.
 * @param id - the catalog entry id.
 * @returns the README, or a response explaining why there is none.
 */
export async function fetchReadme(id: string): Promise<ReadmeResponse> {
  try {
    const response = await fetch(`${BASE}/readme?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    return await response.json() as ReadmeResponse
  } catch (error: unknown) {
    return { ok: false, markdown: '', message: String(error) }
  }
}

/**
 * Install a catalog entry.
 *
 * Only the id travels: the host re-derives the pnpm spec from its own catalog
 * copy, so this call cannot smuggle an arbitrary package argument.
 * @param id - the catalog entry id.
 * @returns the mutation outcome.
 */
export async function installEntry(id: string): Promise<MutationResponse> {
  return readMutation(await post(`${BASE}/install`, { id }))
}

/**
 * Remove an installed package.
 * @param name - the installed package name.
 * @returns the mutation outcome.
 */
export async function uninstallEntry(name: string): Promise<MutationResponse> {
  return readMutation(await post(`${BASE}/uninstall`, { name }))
}

/**
 * POST a JSON body.
 * @param url - the target route.
 * @param body - the value to serialize.
 * @returns the raw response.
 */
async function post(url: string, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

/**
 * Read a mutation response, turning transport failures into the same shape.
 * @param response - the raw response.
 * @returns the mutation outcome.
 */
async function readMutation(response: Response): Promise<MutationResponse> {
  try {
    return await response.json() as MutationResponse
  } catch {
    return { ok: false, needsReload: false, message: `request failed: HTTP ${response.status}` }
  }
}
