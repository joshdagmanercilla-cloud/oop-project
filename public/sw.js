const CACHE_NAME = 'harbor-house-cache-v2';
const assetsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js'
];

// Install the service worker safely
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of assetsToCache) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('Failed to cache:', asset, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch and serve from cache if offline
self.addEventListener('fetch', (event) => {
  // Huwag i-cache ang API calls para laging updated ang orders at menu mula sa database
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Fallback sa index.html kapag offline at nag-navigate
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
