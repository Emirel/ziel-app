/**
 * ZIEL — Service Worker v4
 * Enhancements:
 *  - Push notification handling
 *  - Offline sync support
 *  - Improved caching strategy
 */

const CACHE_VERSION = 'v4';
const APP_SHELL_CACHE = `ziel-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `ziel-runtime-${CACHE_VERSION}`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

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

  if (request.method !== 'GET') return;
  if (isNeverCacheHost(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, APP_SHELL_CACHE).catch(() =>
        caches.match('./index.html')
      )
    );
    return;
  }

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

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ============ PUSH NOTIFICATION HANDLING ============

self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'ZIEL Notifikasi',
    body: 'Anda punya update',
    icon: '/logo-192.png',
    badge: '/logo-192.png'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      notificationData = { ...notificationData, ...payload };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: 'ziel-notification',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    })
  );
});

// ============ NOTIFICATION CLICK HANDLING ============

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Focus existing window if open
      for (let client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if not open
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// ============ BACKGROUND SYNC (Optional) ============

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(
      clients.matchAll().then((clientList) => {
        // Notify client to process offline queue
        clientList.forEach((client) => {
          client.postMessage({
            type: 'SYNC_OFFLINE_QUEUE'
          });
        });
        return Promise.resolve();
      })
    );
  }
});

console.log('ZIEL Service Worker v4 loaded');
