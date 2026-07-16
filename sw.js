/*
 * Noon Report — service worker
 * Makes the app fully usable offline once it has been opened online at
 * least once. Strategy:
 *   - App shell (HTML, manifest, icons): network-first, falling back to
 *     cache, so you always get the latest version when online but keep
 *     working when offline.
 *   - Google Fonts + other GET assets: stale-while-revalidate runtime cache.
 *   - Anything under /api/ (the sync endpoint): never cached — always goes
 *     straight to the network so it fails cleanly when offline and the app
 *     can retry later.
 */
const VERSION = 'noon-report-v1';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

const SHELL_ASSETS = [
  './',
  './voyage_manager.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url) {
  return url.pathname.endsWith('/voyage_manager.html') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname === '/' || url.pathname.endsWith('/') ||
    url.pathname.includes('/icons/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept the sync API — let it hit the network (or fail offline).
  if (url.pathname.startsWith('/api/')) return;

  if (url.origin === self.location.origin && isShellRequest(url)) {
    // network-first for the app shell
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./voyage_manager.html')))
    );
    return;
  }

  // stale-while-revalidate for everything else (fonts, etc.)
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
