'use strict';

// Keep in sync with APP_VERSION in app.js.
const CACHE = 'trailer-route-v6';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'restrictions.js',
  'profile.js',
  'navigation.js',
  'manifest.webmanifest',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 3000;

// cache: 'reload' skips the browser's HTTP cache (GitHub Pages allows 10 minutes),
// so a new version never gets stored next to files from the old one.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// App files: fresh from the network when it answers quickly, otherwise the saved copy.
// Routing, search and map tiles are other origins and always go to the network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (_) { /* offline */ }
  const hit = await cache.match(request, { ignoreSearch: true });
  return hit || network;
}
