// Health Agent Service Worker — Full offline PWA
const CACHE_NAME = 'health-agent-v3';
const CRITICAL_CACHE = 'health-agent-critical-v3';

// Always cached — works offline
const CRITICAL_FILES = [
  '/emergency',
  '/login',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

// Cached after first visit
const SHELL_FILES = [
  '/',
  '/landing'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CRITICAL_CACHE).then((cache) => {
      return cache.addAll(CRITICAL_FILES).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== CRITICAL_CACHE)
            .map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always network for API calls
  if(url.pathname.startsWith('/api/')) return;

  // Emergency page — always serve from cache if available
  if(url.pathname === '/emergency') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CRITICAL_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Network first, cache fallback for everything else
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if(response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if(!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Health Agent', {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag || 'health-agent',
        requireInteraction: data.requireInteraction || false,
        data: data.data || {},
        actions: data.actions || []
      })
    );
  } catch(e) {}
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type:'window' }).then(clientList => {
      for(const client of clientList) {
        if(client.url === url && 'focus' in client) return client.focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
