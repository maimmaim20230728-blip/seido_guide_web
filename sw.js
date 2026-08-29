'use strict';
/* 困りごと制度ガイド Service Worker
   ・install時に実行ファイルをprecache
   ・HTMLはnetwork-first(更新をすぐ反映・オフライン時はキャッシュ)
   ・その他(css/js/manifest/icon)はcache-first
   🔴 更新のたびに CACHE 名を必ず上げる(feedback-always-bump-version)
   🔴 css/js の ?v= は index.html・js/app.js(ASSET_V)と必ず同じ値にする。
      これを揃えないと、旧SWが残る端末で「新しいHTML+古いJS」の組み合わせになり初回起動が壊れる */
const CACHE = 'seido-v4';
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './css/style.css?v=1.2',
  './js/audio.js?v=1.2',
  './js/i18n.js?v=1.2',
  './js/data.js?v=1.2',
  './js/data_en.js?v=1.2',
  './js/app.js?v=1.2',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const isHTML = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
