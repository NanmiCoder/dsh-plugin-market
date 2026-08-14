/**
 * Browser-trust fence for this plugin's mutating routes.
 *
 * DSH applies the same fence to `/api`, but its implementation
 * (`packages/client/connection/src/api-request-trust.ts`) is package-internal
 * — it is not re-exported from `@deepseek-ai/dsh-client-connection`'s entry
 * point — so a plugin route has to carry its own copy rather than depend on a
 * private path. The logic below mirrors that module deliberately; keep them in
 * step if upstream changes.
 *
 * It defends the two confused-deputy paths a browser opens against a local
 * HTTP API: DNS rebinding (the Host header names the attacker's domain while
 * the socket reaches this server) and cross-site requests fired by a malicious
 * page. It is not an authentication layer.
 */

import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads. */
export interface TrustRequest {
  readonly headers: IncomingHttpHeaders
}

/**
 * Read one header value.
 * @param headers - the request headers.
 * @param name - the lowercase header name.
 * @returns the value, or undefined when absent or repeated.
 */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Parse a Host-header authority.
 * @param authority - the raw `host` value.
 * @returns a normalized URL, or undefined when unparsable.
 */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Whether a normalized hostname names the local loopback authority.
 * @param hostname - a WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Decide whether a mutating request may act on this profile.
 *
 * @param request - the incoming request's headers.
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the Host is ours and any browser markers are same-origin.
 */
export function isTrustedRequest(request: TrustRequest, trustedHosts: readonly string[]): boolean {
  // Host fence, applied to every request: a browser fills Host from the URL it
  // believes it is talking to, so a rebound page carries the attacker's domain
  // here even though the socket landed on this server. A plain-HTTP browser
  // read arrives with neither Origin nor Fetch-Metadata, so there is no
  // marker shortcut past this check.
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  // Cross-site fence: modern browsers label the initiator relationship, and an
  // explicit cross-site marker is refused regardless of Origin.
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be this exact
  // authority. Absent Origin is fine — the Host fence already bound the
  // request. The literal "null" is an opaque origin and fails to parse here.
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Whether the request authority matches a configured trusted entry.
 *
 * An entry with an explicit port matches that exact authority; a port-less
 * entry matches the hostname on any port.
 * @param hostUrl - the parsed request authority.
 * @param trustedHosts - the configured entries.
 * @returns true on a match.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return entryUrl.port === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}
