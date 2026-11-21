const CACHE_PREFIX = 'meow-pantry-pwa-';
const CACHE_NAME = CACHE_PREFIX + 'v214';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/tokens.css?v=214',
  './css/styles.css?v=214',
  './js/covers.js?v=214',
  './js/constants.js?v=214',
  './js/utils.js?v=214',
  './js/forecast.js?v=214',
  './js/domain.js?v=214',
  './js/storage.js?v=214',
  './js/stats.js?v=214',
  './js/modal.js?v=214',
  './js/ui.js?v=214',
  './js/ui-pantry.js?v=214',
  './js/ui-daily.js?v=214',
  './js/ui-settings.js?v=214',
  './js/app.js?v=214'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local core assets atomically.
      return cache.addAll(
        CORE_ASSETS.map((url) => new Request(new URL(url, self.location.href), { cache: 'reload' }))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
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
      fetch(event.request, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            return caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => { /* Keep the network response if caching fails. */ })
              .then(() => res);
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((exact) => {
            if (exact) return exact;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return new Response('', { status: 504, statusText: 'Offline' });
          })
        )
    );
    return;
  }

  // Cache-First with an offline guard for static images/icons.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            return caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => { /* Keep the network response if caching fails. */ })
              .then(() => res);
          }
          return res;
        })
        .catch(() => new Response('', { status: 504, statusText: 'Offline Fallback' }));
    })
  );
});
