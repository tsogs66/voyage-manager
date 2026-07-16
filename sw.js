/* Service worker for the Noon Report app.
   Strategy:
   - App shell (HTML/manifest/icons): network-first so a new version deployed on the server
     is picked up whenever internet is available, with the cached copy served offline.
   - Everything else (fonts, etc.): stale-while-revalidate.
   - /api/* (sync endpoints): never intercepted. */
const CACHE = 'noon-report-v1';
const CORE = [
  './',
  'voyage_manager.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;

  const isShell = req.mode === 'navigate' ||
    CORE.some((p) => url.pathname.endsWith(p.replace('./', '/')) || (p === './' && url.pathname === '/'));

  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('voyage_manager.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return resp;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
