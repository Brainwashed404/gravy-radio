// Client-side counterpart to api/fx-proxy.ts. Stations on these hosts were
// confirmed (directly, not assumed) to fail a crossOrigin='anonymous' load
// outright - no Access-Control-Allow-Origin header, so the effects chain's
// second audio element can never get real signal from them. This is only a
// fix for THAT specific problem: normal playback (the primary audio element)
// never calls this, it never needed crossOrigin in the first place. Keep this
// allowlist in sync with ALLOWED_HOSTS in api/fx-proxy.ts - the proxy itself
// enforces the same list server-side regardless, so a mismatch here just
// means a station silently doesn't get proxied, not a security gap.
const PROXIED_HOSTS = new Set([
  'ice.somafm.com',
  'stream-mixtape-geo.ntslive.net',
  'stream-relay-geo.ntslive.net',
]);

/** Returns the URL the fx audio element should actually load: unchanged for
 *  everything that already works directly, rewritten through the CORS proxy
 *  for the specific hosts known to need it. */
export function fxSourceUrl(stationUrl: string): string {
  try {
    const parsed = new URL(stationUrl);
    if (PROXIED_HOSTS.has(parsed.hostname)) {
      return `/api/fx-proxy?url=${encodeURIComponent(stationUrl)}`;
    }
  } catch {
    // Malformed URL - fall through and let the normal load-and-probe flow
    // fail on it the same way it already handles any other bad station URL.
  }
  return stationUrl;
}
