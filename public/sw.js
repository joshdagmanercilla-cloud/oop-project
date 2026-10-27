const CACHE_NAME = 'harbor-house-cache-v1';
const assetsToCache = [
  '/',
  '/index.html',
  '/styles.css', // Pinalitan ng tamang file name mo
  '/app.js'      // Pinalitan ng tamang file name mo
];

// Install the service worker and cache all essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache, adding assets...');
      return cache.addAll(assetsToCache);
    }).catch(err => {
      console.error('Failed to cache assets during install:', err);
    })
  );
  self.skipWaiting(); // Para mag-activate agad
});

// Activate service worker immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Intercept network requests and serve from cache if offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Galing sa cache kung offline o meron
      }
      return fetch(event.request).catch(() => {
        // Optional fallback page dito kung sakaling offline at wala sa cache
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
