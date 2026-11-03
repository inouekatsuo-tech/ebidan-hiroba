// 1件ずつのリマインド通知を、時間どおりに送るための窓口。
// Supabaseのスケジューラ（pg_cron）から数分おきに呼ばれる。
//
// 各端末の「予約」は、通知の購読データ（Vercel Blob）の中に入っている:
//   reminders: [{ id, at:'2026-11-03T21:00', lead:30, title, sent:false }]
import { list, put } from '@vercel/blob';
import webpush from 'web-push';

const SITE = process.env.SITE_URL || 'https://ositopia.com';
const jstNow = () => new Date(Date.now() + 9 * 3600e3);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // 呼び出せるのは、鍵を知っている相手だけ
  const key = req.headers.authorization || '';
  if (!process.env.SUPABASE_SERVICE_KEY || key !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const priv = process.env.VAPID_PRIVATE_KEY, pub = process.env.VAPID_PUBLIC;
  if (!priv || !pub) return res.status(200).json({ ok: true, skipped: '通知の鍵が未設定です' });

  try {
    webpush.setVapidDetails('mailto:info@ositopia.com', pub, priv);
    const now = jstNow();
    const nowMin = now.getTime();
    let sent = 0, checked = 0;

    const { blobs } = await list({ prefix: 'subs/' });
    for (const b of blobs) {
      let sub;
      try { sub = await (await fetch(b.url, { cache: 'no-store' })).json(); } catch { continue; }
      const rem = Array.isArray(sub.reminders) ? sub.reminders : [];
      if (!rem.length) continue;
      checked += rem.length;

      let changed = false;
      for (const r of rem) {
        if (r.sent) continue;
        const target = Date.parse(r.at + ':00+09:00');           // 出演の開始時刻
        if (!target) { r.sent = true; changed = true; continue; }
        const fire = target - (r.lead || 30) * 60000;            // 何分前に送るか
        if (nowMin < fire) continue;                              // まだ早い
        if (nowMin > target + 10 * 60000) { r.sent = true; changed = true; continue; }  // 過ぎたものは捨てる
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({
            title: `まもなく ${r.at.slice(11)}${r.lead >= 60 ? '（1時間前）' : `（${r.lead}分前）`}`,
            body: r.title || '出演予定の時間が近づいています',
            url: `${SITE}/#/info`, tag: 'remind' + r.id,
          }));
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) break;   // 解除済みの端末
        }
        r.sent = true; changed = true;
      }

      if (changed) {
        // 終わった予約を片づけて保存し直す
        sub.reminders = rem.filter(r => !r.sent);
        await put(b.pathname, JSON.stringify(sub), {
          access: 'public', contentType: 'application/json',
          addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
        });
      }
    }
    return res.status(200).json({ ok: true, checked, sent });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'tick failed' });
  }
}
