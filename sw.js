const CACHE_NAME = 'logistics-v6-1-cache-8';
// './index.html' は Cloudflare が './' へ転送するため、転送済み応答を保存しないよう './' のみ登録
const ASSETS = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
// 外部ライブラリ（バージョン固定）。オフライン／通信不良でも使えるようにキャッシュする。
const CDN = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await cache.addAll(ASSETS);
    // 取得に失敗しても、インストール自体は失敗させない
    await Promise.all(CDN.map(url => fetch(url, { mode: 'no-cors' }).then(res => cache.put(url, res)).catch(() => {})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // API（D1）の応答はキャッシュしない
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  // 外部ライブラリ：キャッシュ優先、なければ通信して保存
  if (CDN.includes(event.request.url)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      const copy = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      return res;
    })));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('./'))));
});
