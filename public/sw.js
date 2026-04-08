const ASSETS_CACHE = 'gravy-radio-assets-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== ASSETS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept audio streams
  if (e.request.destination === 'audio' || url.pathname.includes('/stream')) {
    return;
  }

  // Hashed Vite assets (/assets/*.js, /assets/*.css) — cache first, safe because filename = hash
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(ASSETS_CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          if (cached) return cached;
          return fetch(e.request).then((res) => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // HTML and everything else — network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache a copy for offline fallback
        if (res.ok) {
          caches.open(ASSETS_CACHE).then((cache) => cache.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
