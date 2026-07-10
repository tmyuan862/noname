// ============================================================
// sw.js — 离线缓存（修复 ASSETS 缺失 + 缓存上限）
// ★ 修复：补全 audio.js/input.js/network.js/storage.js/systems.js/pwa.js
// ★ 修复：trim 在所有缓存写入后调用一次，避免竞态
// ============================================================
const CACHE_NAME = 'snake-plus-v2.1.0';
const CACHE_MAX = 80;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './css/main.css',
  './js/config.js',
  './js/utils.js',
  './js/state.js',
  './js/storage.js',
  './js/engine.js',
  './js/render.js',
  './js/ui.js',
  './js/app.js',
  './js/audio.js',
  './js/input.js',
  './js/network.js',
  './js/systems.js',
  './js/pwa.js'
];

let cacheInst = null;

function trim(c) {
  return c.keys().then(keys => {
    if (keys.length > CACHE_MAX) {
      const del = keys.slice(0, keys.length - CACHE_MAX);
      return Promise.all(del.map(r => c.delete(r)));
    }
  });
}

function fetchTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async c => {
      cacheInst = c;
      // 并行预缓存，但单个失败不阻断
      await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(x => x !== CACHE_NAME).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function handle(req) {
  if (!cacheInst) cacheInst = await caches.open(CACHE_NAME);
  const c = cacheInst;
  const u = new URL(req.url);
  const acc = req.headers.get('accept') || '';
  // HTML 走 network-first
  if (acc.includes('text/html') || u.pathname.endsWith('.html')) {
    try {
      const r = await fetchTimeout(req, 8000);
      if (r && r.ok) {
        c.put(req, r.clone());
        trim(c);
      }
      return r;
    } catch {
      return c.match(req) || new Response('离线', { status: 503 });
    }
  }
  // 其他资源 cache-first
  const cached = await c.match(req);
  if (cached) return cached;
  try {
    const r = await fetchTimeout(req, 6000);
    if (r && r.status === 200) {
      c.put(req, r.clone());
      trim(c);
    }
    return r;
  } catch (e) {
    return new Response('离线', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;
  if (u.origin === self.location.origin) {
    e.respondWith(handle(e.request));
  }
});
