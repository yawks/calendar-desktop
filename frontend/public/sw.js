const CACHE = 'courrier-shell-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('notificationclick', event => { event.notification.close(); const target = event.notification.data?.url || '/'; event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => { const client = clients.find(item => 'focus' in item); return client ? client.focus() : self.clients.openWindow(target); })); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET' || path.startsWith('/api/') || path.startsWith('/auth/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then(hit => hit || (request.mode === 'navigate' ? caches.match('/index.html') : undefined))));
});
