// アカウントの作成・読み込み・更新。
// 本物のログイン（Google等）を入れるまでは、端末ごとの合言葉（token）で本人確認する。
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const db = () => createClient(URL_, KEY, { auth: { persistSession: false } });
const PUBLIC = 'id,member_no,handle,age_band,pref,oshi,bio,links,follow,banned,created_at';

const NG_HANDLE = /^(管理人|運営|公式|admin|administrator|推しトピア)$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!URL_ || !KEY) return res.status(503).json({ error: 'データベースの設定がまだです' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const sb = db();

    // --- 新規登録 ---
    if (b.action === 'create') {
      const handle = String(b.handle || '').trim();
      if (handle.length < 2 || handle.length > 12) return res.status(400).json({ error: 'ハンドルネームは2〜12文字で入れてください' });
      if (NG_HANDLE.test(handle)) return res.status(400).json({ error: 'その名前は使えません' });

      const token = randomBytes(24).toString('base64url');
      const { data, error } = await sb.from('profiles').insert({
        handle, token,
        age_band: String(b.age || '').slice(0, 10),
        pref: String(b.pref || '').slice(0, 10),
        oshi: String(b.oshi || '').slice(0, 30),
        follow: Array.isArray(b.follow) ? b.follow.slice(0, 20) : [],
      }).select(PUBLIC).single();
      if (error) throw error;

      // 登録した人へ、運営からのあいさつ
      await sb.from('notices').insert({
        user_id: data.id, title: '推しトピアへようこそ！',
        body: `あなたの会員番号は #${String(data.member_no).padStart(6, '0')} です。\n`
          + 'マイページの「会員番号」からQRコードを表示できます。友達に読み取ってもらうと、すぐフォローしてもらえます。\n\n'
          + '情報を見るだけなら登録は不要です。掲示板も名無しのまま書き込めます。\n'
          + '困ったことがあれば、どの書き込みからも「通報」できます。',
      });
      return res.status(200).json({ ok: true, profile: data, token });
    }

    // --- 合言葉でログイン状態を確認 ---
    if (b.action === 'me') {
      if (!b.token) return res.status(400).json({ error: 'token が必要です' });
      const { data } = await sb.from('profiles').select(PUBLIC).eq('token', b.token).single();
      if (!data) return res.status(404).json({ error: 'アカウントが見つかりません' });
      await sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', data.id);
      return res.status(200).json({ ok: true, profile: data });
    }

    // --- プロフィールの更新 ---
    if (b.action === 'update') {
      if (!b.token) return res.status(400).json({ error: 'token が必要です' });
      const patch = {};
      if (b.handle !== undefined) {
        const h = String(b.handle).trim();
        if (h.length < 2 || h.length > 12) return res.status(400).json({ error: 'ハンドルネームは2〜12文字で入れてください' });
        if (NG_HANDLE.test(h)) return res.status(400).json({ error: 'その名前は使えません' });
        patch.handle = h;
      }
      for (const [k, col] of [['age', 'age_band'], ['pref', 'pref'], ['oshi', 'oshi']]) {
        if (b[k] !== undefined) patch[col] = String(b[k]).slice(0, 30);
      }
      if (b.bio !== undefined) patch.bio = String(b.bio).slice(0, 140);
      if (b.links !== undefined) patch.links = b.links;
      if (Array.isArray(b.follow)) patch.follow = b.follow.slice(0, 20);

      const { data, error } = await sb.from('profiles').update(patch).eq('token', b.token).select(PUBLIC).single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'アカウントが見つかりません' });
      return res.status(200).json({ ok: true, profile: data });
    }

    // --- 連携ログイン（Google/Apple/X）からアカウントを作る・ひもづける ---
    if (b.action === 'link') {
      if (!b.accessToken) return res.status(400).json({ error: 'accessToken が必要です' });
      // 受け取ったトークンが本物か、Supabaseに問い合わせて確認する
      const ur = await fetch(`${URL_}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${b.accessToken}`, apikey: KEY },
      });
      if (!ur.ok) return res.status(401).json({ error: 'ログインを確認できませんでした' });
      const authUser = await ur.json();
      const authId = authUser.id;
      if (!authId) return res.status(401).json({ error: 'ログインを確認できませんでした' });

      // すでにこの連携アカウントで登録済みならそれを返す
      const { data: exist } = await sb.from('profiles').select(PUBLIC + ',token').eq('auth_user_id', authId).maybeSingle();
      if (exist) {
        const { token, ...profile } = exist;
        return res.status(200).json({ ok: true, profile, token, linked: true });
      }

      // この端末ですでにアカウントを作っていれば、それに連携をひもづける（会員番号は変わらない）
      if (b.token) {
        const { data: mine } = await sb.from('profiles').select('id').eq('token', b.token).maybeSingle();
        if (mine) {
          const { data } = await sb.from('profiles').update({ auth_user_id: authId }).eq('id', mine.id).select(PUBLIC).single();
          return res.status(200).json({ ok: true, profile: data, token: b.token, linked: true });
        }
      }

      // 新規。プロフィール入力はこのあと画面で行う
      return res.status(200).json({ ok: true, needsProfile: true, authUserId: authId });
    }

    // --- 連携ログインでの新規登録（プロフィール入力後） ---
    if (b.action === 'createLinked') {
      if (!b.accessToken) return res.status(400).json({ error: 'accessToken が必要です' });
      const ur = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${b.accessToken}`, apikey: KEY } });
      if (!ur.ok) return res.status(401).json({ error: 'ログインを確認できませんでした' });
      const authUser = await ur.json();
      const handle = String(b.handle || '').trim();
      if (handle.length < 2 || handle.length > 12) return res.status(400).json({ error: 'ハンドルネームは2〜12文字で入れてください' });
      if (NG_HANDLE.test(handle)) return res.status(400).json({ error: 'その名前は使えません' });

      const token = randomBytes(24).toString('base64url');
      const { data, error } = await sb.from('profiles').insert({
        handle, token, auth_user_id: authUser.id,
        age_band: String(b.age || '').slice(0, 10),
        pref: String(b.pref || '').slice(0, 10),
        oshi: String(b.oshi || '').slice(0, 30),
        follow: Array.isArray(b.follow) ? b.follow.slice(0, 20) : [],
      }).select(PUBLIC).single();
      if (error) throw error;
      await sb.from('notices').insert({
        user_id: data.id, title: '推しトピアへようこそ！',
        body: `あなたの会員番号は #${String(data.member_no).padStart(6, '0')} です。\n`
          + 'マイページの「会員番号」からQRコードを表示できます。',
      });
      return res.status(200).json({ ok: true, profile: data, token });
    }

    // --- 連携ログイン後の新規登録（引換券を使う） ---
    if (b.action === 'createGoogle' || b.action === 'createLinked2') {
      const { data: tk } = await sb.from('auth_tickets').select('*').eq('ticket', String(b.ticket || '')).maybeSingle();
      if (!tk) return res.status(400).json({ error: 'ログインの確認ができませんでした。もう一度お試しください' });
      const handle = String(b.handle || '').trim();
      if (handle.length < 2 || handle.length > 12) return res.status(400).json({ error: 'ハンドルネームは2〜12文字で入れてください' });
      if (NG_HANDLE.test(handle)) return res.status(400).json({ error: 'その名前は使えません' });

      const token = randomBytes(24).toString('base64url');
      const col = { google: 'google_sub', apple: 'apple_sub', x: 'x_sub' }[tk.provider || 'google'];
      const { data, error } = await sb.from('profiles').insert({
        handle, token, [col]: tk.sub || tk.google_sub, email: tk.email,
        age_band: String(b.age || '').slice(0, 10),
        pref: String(b.pref || '').slice(0, 10),
        oshi: String(b.oshi || '').slice(0, 30),
        follow: Array.isArray(b.follow) ? b.follow.slice(0, 20) : [],
      }).select(PUBLIC).single();
      if (error) throw error;
      await sb.from('auth_tickets').delete().eq('ticket', tk.ticket);
      await sb.from('notices').insert({
        user_id: data.id, title: '推しトピアへようこそ！',
        body: `あなたの会員番号は #${String(data.member_no).padStart(6, '0')} です。\n`
          + 'マイページの「会員番号」からQRコードを表示できます。友達に読み取ってもらうと、すぐフォローしてもらえます。',
      });
      return res.status(200).json({ ok: true, profile: data, token });
    }

    // --- 会員番号で探す ---
    if (b.action === 'find') {
      const no = Number(String(b.memberNo || '').replace(/[^0-9]/g, ''));
      if (!no) return res.status(400).json({ error: '会員番号を入れてください' });
      const { data } = await sb.from('profiles').select(PUBLIC).eq('member_no', no).single();
      if (!data) return res.status(404).json({ error: 'その会員番号の人は見つかりませんでした' });
      return res.status(200).json({ ok: true, profile: data });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    const msg = String(e.message || '');
    if (msg.includes('duplicate')) return res.status(409).json({ error: 'すでに使われています' });
    return res.status(500).json({ error: 'サーバー側でエラーが起きました' });
  }
}
