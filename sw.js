// ============================================================
// SERVICE WORKER — lets the home-screen app open without a network
// App files: network first (a new deploy is picked up at once), cache as fallback.
// Versioned CDN libraries and fonts: cache first.
// Firebase Auth/Firestore traffic is never intercepted.
// ============================================================
const CACHE = 'fc-shell-v4';
const SHELL = ['./', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/apple-touch-icon.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
    return;
  }

  // Only versioned library files (Firebase SDK under /firebasejs/, not its API calls)
  const isLib = CDN_HOSTS.includes(url.hostname) &&
    (url.hostname !== 'www.gstatic.com' || url.pathname.startsWith('/firebasejs/'));
  if (isLib) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
