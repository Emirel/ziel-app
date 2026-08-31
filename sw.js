const CACHE_VERSION = 'ziel-cache-v5';
const APP_SHELL_CACHE = `ziel-app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `ziel-runtime-${CACHE_VERSION}`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo-192.png',
  './logo-512.png',
  './screenshot-1.png',
  './screenshot-2.png',
  './splash-192.png',
  './splash-512.png'
];

const DO_NOT_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'open.spotify.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function shouldBypassCache(requestUrl) {
  return DO_NOT_CACHE_HOSTS.some((host) => requestUrl.hostname.includes(host));
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    if (request.method === 'GET' && fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (request.method === 'GET' && response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (
    request.method !== 'GET' &&
    !(request.method === 'POST' && new URL(request.url).pathname === '/share')
  ) {
    return;
  }

  const url = new URL(request.url);

  if (url.pathname === '/share' && request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await request.formData();
      const params = new URLSearchParams({
        shareTitle: String(formData.get('title') || ''),
        shareText: String(formData.get('text') || ''),
        shareUrl: String(formData.get('url') || '')
      });

      return Response.redirect('/?' + params.toString(), 303);
    })());
    return;
  }

  if (shouldBypassCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (
    APP_SHELL_ASSETS.some((asset) => {
      const normalized = asset.replace('./', '/');
      return url.pathname === normalized || url.pathname.endsWith(normalized);
    })
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'ZIEL Reminder',
    body: 'Saatnya kembali ke langkah berikutnya.',
    icon: './logo-192.png',
    badge: './logo-192.png',
    data: { url: '/' }
  };

  try {
    const data = event.data ? event.data.json() : null;
    if (data) {
      payload = {
        ...payload,
        ...data,
        data: {
          url: '/',
          ...(data.data || {})
        }
      };
    }
  } catch (err) {
    // fallback default payload
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      data: payload.data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification?.data?.url || '/',
    self.location.origin
  ).href;

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of clientList) {
      if (client.url.startsWith(self.location.origin)) {
        if ('navigate' in client) {
          await client.navigate(targetUrl);
        }
        return client.focus();
      }
    }

    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(processOfflineQueue());
  }
});

async function processOfflineQueue() {
  const allClients = await clients.matchAll({
    includeUncontrolled: true,
    type: 'window'
  });

  for (const client of allClients) {
    client.postMessage({ type: 'SYNC_OFFLINE_QUEUE' });
  }
}

console.log('ZIEL Service Worker v5 loaded');
