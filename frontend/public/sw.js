const CACHE = 'courrier-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const request = event.request;
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET' || path.startsWith('/api/') || path.startsWith('/auth/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then(hit => hit || (request.mode === 'navigate' ? caches.match('/index.html') : undefined))));
});
