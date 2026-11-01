const SHELL_CACHE = 'harbor-house-shell-v4';
const RUNTIME_CACHE = 'harbor-house-runtime-v4';
const MENU_CACHE = 'harbor-house-menu-v1';
const shellAssets = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/qr.js',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(shellAssets);
    try {
      const response = await fetch('/api/menu');
      if (response.ok) await (await caches.open(MENU_CACHE)).put('/api/menu', response);
    } catch {
      // The shell remains installable when the API is temporarily unavailable.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.startsWith('harbor-house-') && ![SHELL_CACHE, RUNTIME_CACHE, MENU_CACHE].includes(name))
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

const cacheResponse = async (cacheName, request, response) => {
  if (response.ok || response.type === 'opaque') {
    try {
      await (await caches.open(cacheName)).put(request, response.clone());
    } catch {
      // Storage quota and private-browsing restrictions must not break requests.
    }
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    if (!['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'images.unsplash.com'].includes(requestUrl.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try { return cacheResponse(RUNTIME_CACHE, request, await fetch(request)); }
      catch { return Response.error(); }
    })());
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    if (requestUrl.pathname !== '/api/menu') return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return await cacheResponse(MENU_CACHE, request, response);
      } catch {
        // Fall through to the last known menu below.
      }
      const cached = await (await caches.open(MENU_CACHE)).match(request);
      if (cached) return cached;
      return new Response(JSON.stringify({ error: 'The menu is not available offline yet. Connect to the internet and try again.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await cacheResponse(SHELL_CACHE, '/index.html', await fetch(request));
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return cacheResponse(RUNTIME_CACHE, request, await fetch(request));
  })());
});
