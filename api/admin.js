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

// 合言葉の総当たりを防ぐ（同じ回線から15分で10回まちがえたら、しばらく受け付けない）
const FAIL_MAX = 10, FAIL_WINDOW = 15 * 60e3;
async function failCount(sb, ip) {
  const { data } = await sb.from('tokens').select('value').eq('key', 'adminfail:' + ip).maybeSingle();
  const v = data?.value;
  if (!v || Date.now() - (v.at || 0) > FAIL_WINDOW) return 0;
  return v.n || 0;
}
async function noteFail(sb, ip, n) {
  await sb.from('tokens').upsert({ key: 'adminfail:' + ip, value: { n, at: Date.now() }, updated_at: new Date().toISOString() });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const sb = db();
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

    const fails = await failCount(sb, ip);
    if (fails >= FAIL_MAX) return res.status(429).json({ error: 'しばらく経ってからお試しください' });
    if (!okPass(b.pass)) {
      await noteFail(sb, ip, fails + 1);
      return res.status(401).json({ error: '合言葉が違います' });
    }
    if (fails) await sb.from('tokens').delete().eq('key', 'adminfail:' + ip);
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
      let sel = sb.from('profiles')
        .select('id,member_no,handle,age_band,pref,oshi,birthday,bio,links,avatar,banned,created_at,last_seen,email')
        .order('member_no');
      if (q) sel = /^\d+$/.test(q) ? sel.eq('member_no', Number(q)) : sel.ilike('handle', `%${q}%`);
      const { data } = await sel.limit(500);
      const users = data || [];

      // 会員ごとの活動量（フォロワー・フォロー中・書き込み・参加コミュニティ）
      const [fl, ps, cm] = await Promise.all([
        sb.from('follows').select('follower_id,followee_id').limit(20000),
        sb.from('posts').select('user_id').not('user_id', 'is', null).limit(20000),
        sb.from('community_members').select('user_id,status').limit(20000),
      ]);
      const count = (rows, key, test) => {
        const m = {};
        for (const r of rows || []) { if (test && !test(r)) continue; m[r[key]] = (m[r[key]] || 0) + 1; }
        return m;
      };
      const followers = count(fl.data, 'followee_id');
      const following = count(fl.data, 'follower_id');
      const posts = count(ps.data, 'user_id');
      const comms = count(cm.data, 'user_id', r => r.status === 'approved');

      return res.status(200).json({ ok: true, users: users.map(u => ({
        ...u,
        followers: followers[u.id] || 0,
        following: following[u.id] || 0,
        posts: posts[u.id] || 0,
        comms: comms[u.id] || 0,
      })) });
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

    // --- 公開する機能の切り替え ---
    if (a === 'features') {
      if (b.value) {
        await sb.from('settings').upsert({ key: 'features', value: b.value, updated_at: new Date().toISOString() });
      }
      const { data } = await sb.from('settings').select('value').eq('key', 'features').maybeSingle();
      return res.status(200).json({ ok: true, features: data?.value || { community: false, accounts: false, board: true } });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'サーバー側でエラーが起きました' });
  }
}
