// CORS proxy for the effects chain's second audio element, and nothing else.
// SomaFM and NTS never send an Access-Control-Allow-Origin header, so a
// crossOrigin='anonymous' request to them fails outright (confirmed directly,
// not assumed - error code 4 / MEDIA_ERR_SRC_NOT_SUPPORTED on every stream
// tested on both providers). There is no client-side fix for a server that
// never sends the header; this fetches the upstream stream from a server we
// control and re-serves it with that header added.
//
// Deliberately NOT a general-purpose proxy: ALLOWED_HOSTS is an exact-match
// allowlist, not a wildcard or pattern. Without it this endpoint would let
// anyone route arbitrary traffic (audio or otherwise) through this app's own
// bandwidth for free - an open relay, not a fix for one specific problem.
// Normal playback (the primary audio element) never touches this; it only
// exists for the effects path, and only for stations already confirmed to
// need it.
export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = new Set([
  'ice.somafm.com',
  'stream-mixtape-geo.ntslive.net',
  'stream-relay-geo.ntslive.net',
]);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  if (!target) return new Response('Missing url parameter', { status: 400 });

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }

  if (targetUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return new Response('Host not allowed', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LuckyBreaksFxProxy/1.0)' },
      // Client credentials and headers are never forwarded upstream - this is
      // a public radio stream fetch, nothing here needs them.
    });
  } catch {
    return new Response('Upstream fetch failed', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response('Upstream unavailable', { status: 502 });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
