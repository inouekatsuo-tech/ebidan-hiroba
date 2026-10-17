// プロフィールのアイコン画像をアップロードする。
// 画像は送る前にブラウザ側で400×400に縮小してあるので、ここでは形式と大きさだけ確認する。
// （縮小のときに撮影場所などの情報も落ちるため、位置情報が残ったまま公開されることはない）
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'avatars';
const OK = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 600 * 1024;   // 600KB

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    const { data: me } = await sb.from('profiles').select('id,avatar,banned').eq('token', b.token || '').maybeSingle();
    if (!me) return res.status(401).json({ error: 'ログインが必要です' });
    if (me.banned) return res.status(403).json({ error: 'このアカウントは現在凍結されています' });

    // --- 削除 ---
    if (b.remove) {
      for (const ext of Object.values(OK)) await sb.storage.from(BUCKET).remove([`${me.id}.${ext}`]);
      await sb.from('profiles').update({ avatar: null }).eq('id', me.id);
      return res.status(200).json({ ok: true, avatar: null });
    }

    // --- アップロード ---
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(String(b.data || ''));
    if (!m) return res.status(400).json({ error: '画像を選び直してください' });
    const ext = OK[m[1]];
    if (!ext) return res.status(400).json({ error: 'JPEG・PNG・WebPの画像だけ使えます' });

    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ error: '画像を読み取れませんでした' });
    if (buf.length > MAX) return res.status(413).json({ error: '画像が大きすぎます' });

    // 中身が本当にその形式か、先頭の数バイトで確かめる
    const head = buf.subarray(0, 12);
    const isJpg = head[0] === 0xff && head[1] === 0xd8;
    const isPng = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP';
    if (!(isJpg || isPng || isWebp)) return res.status(400).json({ error: '画像として読み取れませんでした' });

    // 前のアイコンが別の形式なら消しておく
    for (const e of Object.values(OK)) if (e !== ext) await sb.storage.from(BUCKET).remove([`${me.id}.${e}`]);

    const path = `${me.id}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: m[1], upsert: true });
    if (error) throw error;

    const base = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const avatar = `${base}?v=${Date.now()}`;          // 更新してもすぐ反映されるように
    await sb.from('profiles').update({ avatar }).eq('id', me.id);
    return res.status(200).json({ ok: true, avatar });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'アップロードできませんでした' });
  }
}
