const CACHE = 'voxel-strike-v3';
const ASSETS = ['/', '/index.html', '/game.js', '/manifest.webmanifest', '/admin.html', '/shop.html', '/servers.html', '/mypage.html', '/maps.html', '/loadouts.html', '/clans.html', '/events.html', '/install.html', '/unity.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => caches.match('/index.html'))));
});
