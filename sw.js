const CACHE_NAME = 'meow-pantry-pwa-v27';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/styles.css?v=27',
  './js/covers.js?v=27',
  './js/constants.js?v=27',
  './js/utils.js?v=27',
  './js/domain.js?v=27',
  './js/storage.js?v=27',
  './js/stats.js?v=27',
  './js/ui.js?v=27',
  './js/app.js?v=27',
  'https://cdn.tailwindcss.com/3.4.17'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local core assets atomically, and attempt optional external CDN without blocking install offline
      const localAssets = CORE_ASSETS.filter((u) => !u.startsWith('http'));
      const remoteAssets = CORE_ASSETS.filter((u) => u.startsWith('http'));
      return cache.addAll(localAssets).then(() =>
        Promise.allSettled(remoteAssets.map((url) => cache.add(url)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let reqUrl;
  try {
    reqUrl = new URL(event.request.url);
  } catch (e) {
    return;
  }

  const isSameOrigin = reqUrl.origin === self.location.origin;
  const isAppCodeOrDoc =
    event.request.mode === 'navigate' ||
    (isSameOrigin && /\.(html|js|css|json)$/i.test(reqUrl.pathname)) ||
    (isSameOrigin && reqUrl.pathname.endsWith('/'));

  // Network-First for all local HTML/JS/CSS/JSON so GitHub Pages updates take effect immediately without version skew;
  // falls back to offline cache seamlessly when disconnected!
  if (isAppCodeOrDoc) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((exact) => {
            if (exact) return exact;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return caches.match(reqUrl.pathname);
          })
        )
    );
    return;
  }

  // Cache-First with background update & offline .catch() guard for static images/icons & external CDN
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => new Response('', { status: 504, statusText: 'Offline Fallback' }));
    })
  );
});
