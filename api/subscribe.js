// 通知の購読を受け付ける（ブラウザ → ここ → データベース）
// 保存するのは「通知の送り先」と「どの通知がほしいか」だけ。名前やメールアドレスは保存しない。
import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { subscription, follow = [], noti = {}, unsubscribe, token, reminders } = body;
    if (!subscription?.endpoint || !/^https:\/\//.test(subscription.endpoint)) {
      return res.status(400).json({ error: 'subscription が不正です' });
    }
    const sb = db();
    const endpoint = subscription.endpoint;

    if (unsubscribe) {
      await sb.from('push_subs').delete().eq('endpoint', endpoint);   // 予約もまとめて消える
      return res.status(200).json({ ok: true, unsubscribed: true });
    }

    // ログインしている人なら、その人あての通知も送れるように会員のIDを控える
    let userId = null;
    if (token) {
      const { data: me } = await sb.from('profiles').select('id').eq('token', token).maybeSingle();
      userId = me?.id || null;
    }

    await sb.from('push_subs').upsert({
      endpoint, keys: subscription.keys || {},
      follow: Array.isArray(follow) ? follow.slice(0, 20).map(String) : [],
      noti: { remind: noti.remind !== false, live: noti.live !== false, news: noti.news !== false, comm: noti.comm !== false },
      user_id: userId,
      updated_at: new Date().toISOString(),
    });

    // リマインドの予約は、送られてきた内容でそのまま置き換える
    if (Array.isArray(reminders)) {
      await sb.from('reminders').delete().eq('endpoint', endpoint).eq('sent', false);
      const rows = reminders.slice(0, 50).map(r => {
        const at = String(r.at || '');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return null;
        const lead = Math.min(180, Math.max(5, Number(r.lead) || 30));
        const start = new Date(at + ':00+09:00');
        if (isNaN(start)) return null;
        return {
          endpoint, item_id: String(r.id || '').slice(0, 80),
          start_at: start.toISOString(),
          fire_at: new Date(start.getTime() - lead * 60000).toISOString(),
          lead, title: String(r.title || '').slice(0, 80),
        };
      }).filter(Boolean);
      if (rows.length) await sb.from('reminders').insert(rows);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '登録できませんでした' });
  }
}
