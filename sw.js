/**
 * Indoor Distance — Service Worker v1.2
 * Strategi: Cache-first för shell, network-first för API
 * Version: 1.2 (2026-06)
 */

const CACHE_VERSION = 'id-v1.3-2026-07';
const CACHE_NAME = `indoor-distance-${CACHE_VERSION}`;
const CDN_CACHE_NAME = `indoor-distance-cdn-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './indoor_distance_pro (1).html',
  './indoor_distance_pro%20(1).html',
  './manifest.json'
];

// Install: precache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.warn('[SW] Some shell files failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== CDN_CACHE_NAME && name.startsWith('indoor-distance-'))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategies
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Always network for AI/backend APIs
  if (url.hostname.includes('anthropic.com') ||
      url.hostname.includes('openai.com') ||
      url.hostname.includes('supabase.co')) {
    return;
  }

  // CDN: cache-first
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdn.pixabay.com')) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || new Response('Offline', { status: 503 }));
        })
      )
    );
    return;
  }

  // Same-origin: network-first with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && response.status < 400) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') ||
                   caches.match('./indoor_distance_pro (1).html') ||
                   caches.match('./indoor_distance_pro%20(1).html');
          }
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  let data = { title: 'Indoor Distance', body: 'Du har en ny notis' };
  try { if (event.data) data = event.data.json(); }
  catch (e) {
    try { data = { title: 'Indoor Distance', body: event.data.text() }; } catch (e2) {}
  }
  const options = {
    body: data.body || '',
    icon: data.icon || './manifest.json',
    badge: data.badge || './manifest.json',
    tag: data.tag || 'indoor-distance',
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    vibrate: data.vibrate || [100, 50, 100],
    actions: data.actions || []
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Indoor Distance', options));
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (event.notification.data && event.notification.data.url) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: event.notification.data.url });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Background sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-results') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_RESULTS' }));
      })
    );
  }
});

// Message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
