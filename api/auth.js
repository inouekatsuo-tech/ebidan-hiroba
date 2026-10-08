// Googleログインを推しトピア自身で処理する。
// こうすると、Googleの画面に「ositopia.com にログイン」と表示される。
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';

const SITE = process.env.SITE_URL || 'https://ositopia.com';
const CB = `${SITE}/api/auth`;                       // Googleから戻ってくる先
const CID = process.env.GOOGLE_CLIENT_ID;
const CSEC = process.env.GOOGLE_CLIENT_SECRET;
const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PUBLIC = 'id,member_no,handle,age_band,pref,oshi,bio,links,follow,banned,created_at';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!CID || !CSEC) return res.status(503).send('Googleログインの設定がまだです');
  const { code, state, start, error } = req.query || {};

  // --- ① ログイン開始：Googleへ送り出す ---
  if (start || (!code && !error)) {
    const st = randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `osl=${st}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', CID);
    u.searchParams.set('redirect_uri', CB);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', st);
    u.searchParams.set('prompt', 'select_account');
    return res.redirect(302, u.toString());
  }

  if (error) return res.redirect(302, `${SITE}/#/me?login=cancel`);

  // --- ② Googleから戻ってきた：本人確認してアカウントを用意する ---
  try {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('osl='));
    if (!cookie || cookie.slice(4) !== state) return res.redirect(302, `${SITE}/#/me?login=state`);

    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CID, client_secret: CSEC, redirect_uri: CB, grant_type: 'authorization_code' }),
    });
    if (!tr.ok) throw new Error('token ' + tr.status);
    const { id_token } = await tr.json();

    // Googleが発行した証明書（IDトークン）が本物かGoogleに確認する
    const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(id_token));
    if (!vr.ok) throw new Error('tokeninfo ' + vr.status);
    const info = await vr.json();
    if (info.aud !== CID || !info.sub) throw new Error('aud mismatch');

    const sb = db();
    const { data: exist } = await sb.from('profiles').select(PUBLIC + ',token').eq('google_sub', info.sub).maybeSingle();
    if (exist) {
      res.setHeader('Set-Cookie', 'osl=; Path=/; Max-Age=0');
      return res.redirect(302, `${SITE}/#/auth?t=${encodeURIComponent(exist.token)}`);
    }

    // はじめての人は、プロフィール入力へ（仮の引換券を渡す）
    const ticket = createHash('sha256').update(info.sub + CSEC).digest('base64url').slice(0, 32);
    await sb.from('auth_tickets').upsert({
      ticket, google_sub: info.sub, email: info.email || null,
      created_at: new Date().toISOString(),
    });
    res.setHeader('Set-Cookie', 'osl=; Path=/; Max-Age=0');
    return res.redirect(302, `${SITE}/#/auth?new=${encodeURIComponent(ticket)}`);
  } catch (e) {
    console.error(e);
    return res.redirect(302, `${SITE}/#/me?login=error`);
  }
}
