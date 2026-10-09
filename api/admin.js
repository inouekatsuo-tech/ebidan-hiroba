// 運営の管理画面用API。合言葉を知っている人だけが使える。
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function okPass(given) {
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!okPass(b.pass)) return res.status(401).json({ error: '合言葉が違います' });
    const sb = db();
    const a = b.action;

    if (a === 'login') return res.status(200).json({ ok: true });

    // --- ダッシュボード ---
    if (a === 'stats') {
      const count = async (t, f) => {
        let q = sb.from(t).select('*', { count: 'exact', head: true });
        if (f) q = f(q);
        const { count: c } = await q;
        return c || 0;
      };
      const [users, threads, posts, reports, openReports, hidden, banned] = await Promise.all([
        count('profiles'), count('threads'), count('posts'),
        count('reports'), count('reports', q => q.eq('done', false)),
        count('posts', q => q.eq('hidden', true)), count('profiles', q => q.eq('banned', true)),
      ]);
      const { data: recent } = await sb.from('posts')
        .select('id,thread_id,no,body,author_name,anon_id,hidden,created_at,threads(title)')
        .order('created_at', { ascending: false }).limit(10);
      return res.status(200).json({ ok: true, stats: { users, threads, posts, reports, openReports, hidden, banned }, recent });
    }

    // --- 通報一覧 ---
    if (a === 'reports') {
      const { data } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(50);
      const ids = (data || []).map(r => Number(String(r.target_id).replace(/^db/, ''))).filter(Boolean);
      const { data: posts } = ids.length
        ? await sb.from('posts').select('id,thread_id,no,body,author_name,anon_id,hidden,threads(title)').in('id', ids)
        : { data: [] };
      return res.status(200).json({ ok: true, reports: data || [], posts: posts || [] });
    }

    // --- ユーザー一覧・検索 ---
    if (a === 'users') {
      const q = String(b.q || '').trim();
      let sel = sb.from('profiles').select('id,member_no,handle,age_band,pref,oshi,banned,created_at,email').order('member_no');
      if (q) sel = /^\d+$/.test(q) ? sel.eq('member_no', Number(q)) : sel.ilike('handle', `%${q}%`);
      const { data } = await sel.limit(50);
      return res.status(200).json({ ok: true, users: data || [] });
    }

    // --- 書き込みを非表示／再表示 ---
    if (a === 'hide') {
      const id = Number(String(b.postId).replace(/^db/, ''));
      const { data: cur } = await sb.from('posts').select('hidden').eq('id', id).single();
      await sb.from('posts').update({ hidden: !cur?.hidden }).eq('id', id);
      return res.status(200).json({ ok: true, hidden: !cur?.hidden });
    }

    // --- アカウントの凍結／解除 ---
    if (a === 'ban') {
      const { data: cur } = await sb.from('profiles').select('banned,handle').eq('id', b.userId).single();
      await sb.from('profiles').update({ banned: !cur?.banned, banned_note: b.reason || null }).eq('id', b.userId);
      return res.status(200).json({ ok: true, banned: !cur?.banned, handle: cur?.handle });
    }

    // --- お知らせ送信（全員 or 個人） ---
    if (a === 'notice') {
      const title = String(b.title || '').trim(), body = String(b.body || '').trim();
      if (!title || !body) return res.status(400).json({ error: '件名と本文を入れてください' });
      const { error } = await sb.from('notices').insert({ user_id: b.userId || null, title, body });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // --- ハンドルネームの変更 ---
    if (a === 'rename') {
      const h = String(b.handle || '').trim();
      if (h.length < 2 || h.length > 12) return res.status(400).json({ error: 'ハンドルネームは2〜12文字です' });
      await sb.from('profiles').update({ handle: h }).eq('id', b.userId);
      return res.status(200).json({ ok: true });
    }

    // --- 通報の対応済み切り替え ---
    if (a === 'reportDone') {
      const { data: cur } = await sb.from('reports').select('done').eq('id', b.reportId).single();
      await sb.from('reports').update({ done: !cur?.done }).eq('id', b.reportId);
      return res.status(200).json({ ok: true, done: !cur?.done });
    }

    // --- 広告の設定 ---
    if (a === 'ads') {
      if (b.value) {
        await sb.from('settings').upsert({ key: 'ads', value: b.value, updated_at: new Date().toISOString() });
      }
      const { data } = await sb.from('settings').select('value').eq('key', 'ads').single();
      return res.status(200).json({ ok: true, ads: data?.value || {} });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'サーバー側でエラーが起きました' });
  }
}
