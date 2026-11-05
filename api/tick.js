// 予約したリマインドを、時間どおりに送る。
// Supabaseのスケジューラ（pg_cron）から数分おきに呼ばれる。
// 「送る分だけ」をデータベースに問い合わせるので、空振りのときはほぼ何もしない。
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const SITE = process.env.SITE_URL || 'https://ositopia.com';
const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.headers.authorization || '';
  if (!process.env.SUPABASE_SERVICE_KEY || key !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const priv = process.env.VAPID_PRIVATE_KEY, pub = process.env.VAPID_PUBLIC;
  if (!priv || !pub) return res.status(200).json({ ok: true, skipped: '通知の鍵が未設定です' });

  try {
    const sb = db();
    const now = new Date();
    // 送る時刻を過ぎていて、まだ出演が終わっていないもの
    const { data: due } = await sb.from('reminders')
      .select('id,endpoint,lead,title,start_at,push_subs(keys,noti)')
      .eq('sent', false)
      .lte('fire_at', now.toISOString())
      .gte('start_at', new Date(now.getTime() - 10 * 60000).toISOString())
      .limit(100);

    if (!due?.length) {
      // 時間が過ぎてしまったものは片づけておく
      await sb.from('reminders').delete().lt('start_at', new Date(now.getTime() - 86400e3).toISOString());
      return res.status(200).json({ ok: true, sent: 0 });
    }

    webpush.setVapidDetails('mailto:info@ositopia.com', pub, priv);
    const done = [], gone = [];
    for (const r of due) {
      const sub = r.push_subs;
      if (!sub || sub.noti?.remind === false) { done.push(r.id); continue; }
      const hhmm = new Date(new Date(r.start_at).getTime() + 9 * 3600e3).toISOString().slice(11, 16);
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: sub.keys }, JSON.stringify({
          title: `まもなく ${hhmm}（${r.lead >= 60 ? '1時間' : r.lead + '分'}前）`,
          body: r.title || '出演予定の時間が近づいています',
          url: `${SITE}/#/home`, tag: 'remind' + r.id,
        }));
        done.push(r.id);
      } catch (e) {
        done.push(r.id);
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(r.endpoint);   // 解除済みの端末
      }
    }
    if (done.length) await sb.from('reminders').update({ sent: true }).in('id', done);
    if (gone.length) await sb.from('push_subs').delete().in('endpoint', gone);
    return res.status(200).json({ ok: true, sent: done.length, removed: gone.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'tick failed' });
  }
}
