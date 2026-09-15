// Increase this version when changing the offline shell or cache strategy.
const CACHE_PREFIX = 'tkb-' + new URL(self.registration.scope).pathname + '-';
const CACHE_NAME = CACHE_PREFIX + 'v14';
const APP_URL = new URL('./', self.registration.scope).href;
const ASSETS = [
  './', './index.html', './checklist.js', './auth-sync.js', './cloud-config.js', './checklist.css', './images.jpeg', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
].map(path => new URL(path, APP_URL).href);

self.addEventListener('install', event => {
  // The static app can adopt the complete new offline shell without reloading an open page.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !ASSETS.includes(url.origin + url.pathname)) return;

  // Fetch the latest timetable when online; use the saved copy when offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = request.mode === 'navigate' ? APP_URL : url.origin + url.pathname;
    try {
      const response = await fetch(request, {cache: 'no-cache'});
      if (response.ok) {
        // A storage failure must not prevent the online response from loading.
        try { await cache.put(key, response.clone()); } catch (error) { console.warn(error); }
        return response;
      }
      return (await cache.match(key)) || response;
    } catch (error) {
      return (await cache.match(key)) || Response.error();
    }
  })());
});
