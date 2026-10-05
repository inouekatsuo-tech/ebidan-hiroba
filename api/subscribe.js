// 通知の購読を受け付ける（ブラウザ → ここ → Vercel Blobに保存）
// 保存するのは「通知の送り先」と「どのグループの通知がほしいか」だけ。
// 名前やメールアドレスは保存しない。
import { put, del, list } from '@vercel/blob';
import { createHash } from 'node:crypto';

const key = endpoint => 'subs/' + createHash('sha256').update(endpoint).digest('hex').slice(0, 32) + '.json';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { subscription, follow = [], noti = {}, unsubscribe } = body;
    if (!subscription?.endpoint || !/^https:\/\//.test(subscription.endpoint)) {
      return res.status(400).json({ error: 'subscription が不正です' });
    }

    const path = key(subscription.endpoint);

    if (unsubscribe) {
      const found = await list({ prefix: path });
      await Promise.all(found.blobs.map(b => del(b.url)));
      return res.status(200).json({ ok: true, unsubscribed: true });
    }

    const data = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      follow: Array.isArray(follow) ? follow.slice(0, 20).map(String) : [],
      noti: { live: noti.live !== false, news: noti.news !== false, comm: noti.comm !== false },
      updated: new Date().toISOString(),
    };
    await put(path, JSON.stringify(data), {
      access: 'public', contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '保存に失敗しました' });
  }
}
