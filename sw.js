/**
 * ZIEL — Service Worker
 * Strategy:
 *  - App shell (index.html, manifest.json) -> precached on install, served
 *    network-first with cache fallback so users always get the latest
 *    version when online, and the app still opens offline.
 *  - Same-origin static assets -> cache-first, filled in as they're used.
 *  - Cross-origin CDN assets (fonts, Tailwind, Lucide, Firebase SDK) ->
 *    stale-while-revalidate so the app works offline after first load
 *    but still picks up updates in the background.
 *  - Firebase Auth / Firestore API calls and any non-GET request are
 *    NEVER intercepted — they need a live network connection to work
 *    correctly (auth tokens, real-time sync), and caching them would
 *    cause stale or broken data.
 */

const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `ziel-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `ziel-runtime-${CACHE_VERSION}`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Hosts whose responses should never be cached or served from cache —
// live API traffic that must always hit the network.
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .catch((err) => console.warn('SW: precache failed', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isNeverCacheHost(url) {
  return NEVER_CACHE_HOSTS.some((host) => url.hostname === host);
}

// Network-first: try the network, fall back to cache, and refresh the
// cache with whatever the network returned.
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// Stale-while-revalidate: serve from cache immediately if present, and
// update the cache in the background for next time.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || networkFetch;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle safe, cacheable GET requests. Everything else (POST to
  // Firebase, etc.) goes straight to the network untouched.
  if (request.method !== 'GET') return;
  if (isNeverCacheHost(url)) return;

  // Navigations (opening/refreshing the app) -> app shell, network-first.
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, APP_SHELL_CACHE).catch(() =>
        caches.match('./index.html')
      )
    );
    return;
  }

  // Same-origin static assets -> cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // Cross-origin CDN assets (fonts, Tailwind, Lucide, Firebase SDK JS
  // files) -> stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
