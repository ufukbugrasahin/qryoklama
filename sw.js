const CACHE = 'qryoklama-v3';
const STATIC = ['/', '/index.html', '/app.js', '/style.css', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // API isteklerini cache'leme, her zaman network'ten al
    if (e.request.url.includes('/sync') || e.request.url.includes('/login') ||
        e.request.url.includes('/admin') || e.request.url.includes('/teacher') ||
        e.request.url.includes('/student')) {
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
