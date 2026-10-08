// ホーム画面アプリとして動くための最小限のService Worker。
// 通信はそのまま通し、オフラインのときだけ最後に見たページを返す。
const CACHE = 'ositopia-v18';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // 古いキャッシュを捨てて、更新がすぐ反映されるようにする
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const c = await caches.open(CACHE); c.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      throw err;
    }
  })());
});

// 通知をタップしたら、アプリの該当ページを開く
self.addEventListener('notificationclick', e => {
  e.notification.close();
  try { self.navigator.clearAppBadge && self.navigator.clearAppBadge(); } catch (err) {}
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  })());
});

// サーバーから送られてくるプッシュ通知（送信側は今後実装）
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '推しトピア', body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || '推しトピア', {
      body: d.body || '', icon: 'icon-192.png', badge: 'badge.png', tag: d.tag || 'ositopia', data: { url: d.url || '/' },
    });
    // アプリのアイコンに未読の数を出す（iOS 16.4以降・Android対応）
    try {
      const n = (await self.registration.getNotifications()).length || 1;
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
    } catch (err) {}
  })());
});
