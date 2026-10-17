// ホーム画面アプリとして動くための最小限のService Worker。
// 通信はそのまま通し、オフラインのときだけ最後に見たページを返す。
const CACHE = 'ositopia-v29';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // 古いキャッシュを捨てて、更新がすぐ反映されるようにする
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 外部（Xの埋め込みなど）はそのままブラウザに任せる
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const net = fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
      return res;
    }).catch(() => null);
    const hit = await caches.match(e.request);
    if (!hit) {
      const res = await net;
      if (res) return res;
      throw new Error('offline');
    }
    // 電波が悪くて5秒たっても返事が来ないときは、前に見たものを先に表示する
    const slow = new Promise(r => setTimeout(() => r(null), 5000));
    return (await Promise.race([net, slow])) || hit;
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
