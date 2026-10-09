// 連携ログイン（Google / Apple / X）を推しトピア自身で処理する。
// こうすることで、各社のログイン画面に「ositopia.com」と表示される。
//
// 使い方: /api/auth?start=1&p=google  → 各社へ送り出す
//        /api/auth?code=...&state=... → 戻ってきたところ（各社に登録するURLはこれ）
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash, createSign } from 'node:crypto';

const SITE = process.env.SITE_URL || 'https://ositopia.com';
const CB = `${SITE}/api/auth`;
const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PUBLIC = 'id,member_no,handle,age_band,pref,oshi,bio,links,follow,banned,created_at';
const b64url = buf => Buffer.from(buf).toString('base64url');

// Appleは「秘密鍵で署名した証明書」をパスワード代わりに使う
function appleClientSecret() {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_SERVICE_ID, APPLE_PRIVATE_KEY } = process.env;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: APPLE_KEY_ID }));
  const payload = b64url(JSON.stringify({
    iss: APPLE_TEAM_ID, iat: now, exp: now + 3600,
    aud: 'https://appleid.apple.com', sub: APPLE_SERVICE_ID,
  }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const pem = APPLE_PRIVATE_KEY.includes('\n') ? APPLE_PRIVATE_KEY : APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const der = signer.sign({ key: pem, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(der)}`;
}

const PROVIDERS = {
  google: {
    name: 'Google',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extra: { prompt: 'select_account' },
    async identify(tokens) {
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokens.id_token));
      if (!r.ok) throw new Error('tokeninfo ' + r.status);
      const info = await r.json();
      if (info.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('aud mismatch');
      return { sub: info.sub, email: info.email || null, name: info.name || '' };
    },
  },
  apple: {
    name: 'Apple',
    auth: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    clientId: () => process.env.APPLE_SERVICE_ID,
    clientSecret: () => appleClientSecret(),
    extra: { response_mode: 'form_post' },   // Appleは戻りがPOSTになる
    async identify(tokens) {
      // Appleは身元の情報をIDトークンに入れて返す
      const [, payload] = tokens.id_token.split('.');
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (d.aud !== process.env.APPLE_SERVICE_ID) throw new Error('aud mismatch');
      if (d.iss !== 'https://appleid.apple.com') throw new Error('iss mismatch');
      if (d.exp * 1000 < Date.now()) throw new Error('expired');
      return { sub: d.sub, email: d.email || null, name: '' };
    },
  },
  x: {
    name: 'X',
    auth: 'https://x.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token',
    scope: 'tweet.read users.read',
    pkce: true,                                // Xは「合言葉方式」が必須
    clientId: () => process.env.X_CLIENT_ID,
    clientSecret: () => process.env.X_CLIENT_SECRET,
    async identify(tokens) {
      const r = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
      if (!r.ok) throw new Error('users/me ' + r.status);
      const { data } = await r.json();
      return { sub: data.id, email: null, name: data.username || '' };
    },
  },
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

export const config = { api: { bodyParser: { enabled: true } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const body = req.method === 'POST' ? await readBody(req) : {};
  const code = q.code || body.code;
  const state = q.state || body.state;
  const error = q.error || body.error;

  // --- ① 送り出す ---
  if (!code && !error) {
    const key = String(q.p || 'google').toLowerCase();
    const P = PROVIDERS[key];
    if (!P || !P.clientId()) return res.redirect(302, `${SITE}/#/me?login=unavailable`);

    const st = randomBytes(16).toString('hex');
    let verifier = null, challenge = null;
    if (P.pkce) {
      verifier = randomBytes(32).toString('base64url');
      challenge = createHash('sha256').update(verifier).digest('base64url');
    }
    await db().from('auth_sessions').insert({ state: st, provider: key, verifier });

    const u = new URL(P.auth);
    u.searchParams.set('client_id', P.clientId());
    u.searchParams.set('redirect_uri', CB);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', P.scope);
    u.searchParams.set('state', st);
    if (P.pkce) { u.searchParams.set('code_challenge', challenge); u.searchParams.set('code_challenge_method', 'S256'); }
    for (const [k, v] of Object.entries(P.extra || {})) u.searchParams.set(k, v);
    return res.redirect(302, u.toString());
  }

  if (error) return res.redirect(302, `${SITE}/#/me?login=cancel`);

  // --- ② 戻ってきた ---
  try {
    const sb = db();
    const { data: sess } = await sb.from('auth_sessions').select('*').eq('state', String(state || '')).maybeSingle();
    if (!sess) return res.redirect(302, `${SITE}/#/me?login=state`);
    await sb.from('auth_sessions').delete().eq('state', sess.state);
    const P = PROVIDERS[sess.provider];

    const form = new URLSearchParams({
      code: String(code), grant_type: 'authorization_code', redirect_uri: CB, client_id: P.clientId(),
    });
    if (P.pkce) form.set('code_verifier', sess.verifier);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (P.pkce) headers.Authorization = 'Basic ' + Buffer.from(`${P.clientId()}:${P.clientSecret()}`).toString('base64');
    else form.set('client_secret', P.clientSecret());

    const tr = await fetch(P.token, { method: 'POST', headers, body: form });
    if (!tr.ok) throw new Error('token ' + tr.status + ' ' + (await tr.text()).slice(0, 120));
    const tokens = await tr.json();
    const me = await P.identify(tokens);

    const col = { google: 'google_sub', apple: 'apple_sub', x: 'x_sub' }[sess.provider];
    const { data: exist } = await sb.from('profiles').select(PUBLIC + ',token').eq(col, me.sub).maybeSingle();
    if (exist) return res.redirect(302, `${SITE}/#/auth?t=${encodeURIComponent(exist.token)}`);

    const ticket = randomBytes(18).toString('base64url');
    await sb.from('auth_tickets').insert({
      ticket, provider: sess.provider, sub: me.sub,
      google_sub: sess.provider === 'google' ? me.sub : null,
      email: me.email, name: me.name,
    });
    return res.redirect(302, `${SITE}/#/auth?new=${encodeURIComponent(ticket)}&p=${sess.provider}`);
  } catch (e) {
    console.error(e);
    return res.redirect(302, `${SITE}/#/me?login=error`);
  }
}
