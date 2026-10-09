// メールアドレスでのログイン。
// ① コードを送る（send）→ ② 6桁のコードで確認（verify）
import { createClient } from '@supabase/supabase-js';
import { randomInt, createHash, randomBytes } from 'node:crypto';

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PUBLIC = 'id,member_no,handle,age_band,pref,oshi,bio,links,follow,banned,created_at';
const hash = (code, email) => createHash('sha256').update(code + '|' + email + '|' + process.env.SUPABASE_SERVICE_KEY).digest('hex');
const okMail = e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e);

async function sendMail(to, code) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('メール送信の設定がまだです');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || '推しトピア <info@ositopia.com>',
      to: [to],
      subject: `推しトピア 確認コード ${code}`,
      text: `推しトピアの確認コードです。\n\n    ${code}\n\nアプリの画面に入力してください（10分間有効）。\n\nこのメールに心当たりがない場合は、何もせずに削除してください。\n\nhttps://ositopia.com`,
    }),
  });
  if (!r.ok) throw new Error('メールを送れませんでした: ' + (await r.text()).slice(0, 120));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!okMail(email)) return res.status(400).json({ error: 'メールアドレスの形式を確認してください' });
    const sb = db();

    // --- ① 確認コードを送る ---
    if (b.action === 'send') {
      const { data: prev } = await sb.from('email_codes').select('sent_at').eq('email', email).maybeSingle();
      if (prev && Date.now() - new Date(prev.sent_at) < 60000) {
        return res.status(429).json({ error: '1分ほど待ってから、もう一度お試しください' });
      }
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      await sb.from('email_codes').upsert({ email, code_hash: hash(code, email), tries: 0, sent_at: new Date().toISOString() });
      await sendMail(email, code);
      return res.status(200).json({ ok: true });
    }

    // --- ② コードを確認する ---
    if (b.action === 'verify') {
      const code = String(b.code || '').replace(/[^0-9]/g, '');
      const { data: rec } = await sb.from('email_codes').select('*').eq('email', email).maybeSingle();
      if (!rec) return res.status(400).json({ error: 'もう一度コードを送信してください' });
      if (Date.now() - new Date(rec.sent_at) > 600000) return res.status(400).json({ error: 'コードの有効期限が切れました。もう一度送信してください' });
      if (rec.tries >= 5) return res.status(429).json({ error: '入力を間違えすぎました。もう一度送信してください' });
      if (rec.code_hash !== hash(code, email)) {
        await sb.from('email_codes').update({ tries: rec.tries + 1 }).eq('email', email);
        return res.status(400).json({ error: 'コードが違います' });
      }
      await sb.from('email_codes').delete().eq('email', email);

      const { data: exist } = await sb.from('profiles').select(PUBLIC + ',token').eq('email_login', email).maybeSingle();
      if (exist) {
        const { token, ...profile } = exist;
        return res.status(200).json({ ok: true, profile, token });
      }
      const ticket = randomBytes(18).toString('base64url');
      await sb.from('auth_tickets').insert({ ticket, provider: 'email', sub: email, email });
      return res.status(200).json({ ok: true, needsProfile: true, ticket });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'サーバー側でエラーが起きました' });
  }
}
