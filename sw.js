const CACHE = 'noon-report-v106';
const PRECACHE = [
  './voyage_manager.html',
  './eorb.js',
  './sw.js',
  './manifest.webmanifest',
  './icons/logoBG.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

async function notifyClients(message){
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    try{ client.postMessage(message); }catch(_){}
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const total = PRECACHE.length;
      let done = 0;
      await notifyClients({ type: 'INSTALL_PROGRESS', phase: 'start', done: 0, total, pct: 0 });
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch (_) {
          /* optional assets (icons) should not block install */
        }
        done += 1;
        const pct = Math.round((done / total) * 100);
        await notifyClients({ type: 'INSTALL_PROGRESS', phase: 'file', url, done, total, pct });
      }
      await notifyClients({ type: 'INSTALL_PROGRESS', phase: 'done', done: total, total, pct: 100 });
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  /* Never cache sync API — always hit the network (or fail offline). */
  if (url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && request.url.startsWith(self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      /* Cache-first for app shell so Android/PC stay usable offline. */
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'GET_CACHE_NAME' && event.source) {
    try{ event.source.postMessage({ type: 'CACHE_NAME', cache: CACHE, precache: PRECACHE }); }catch(_){}
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'noon-report-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'SYNC_REQUESTED' }));
      })
    );
  }
});
