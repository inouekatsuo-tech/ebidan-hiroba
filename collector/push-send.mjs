// 新しく入った情報をもとに、購読者へプッシュ通知を送る。
// GitHub Actions から、情報収集のあとに実行する。
//
// 必要な環境変数:
//   VAPID_PRIVATE_KEY     … 通知の署名に使う秘密鍵（GitHub Secrets）
//   BLOB_READ_WRITE_TOKEN … 購読者の保存先（Vercel Blob）
// どちらか無いときは、何もせず正常終了する。
import { readFile, writeFile } from 'node:fs/promises';
import { list, del } from '@vercel/blob';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const ITEMS = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const STATE = new URL('./push-state.json', import.meta.url);
const SITE = process.env.SITE_URL || 'https://ositopia.com';
const VAPID_PUBLIC = 'BBrg_UQ1b9l-BGpztBQmAnhQroZDk8NaZHuG-es6Wx4m_HKfEJhBkURR8IZuIv-dGOQArskgBFJsL_bnpMs9rxU';
const MAX_PER_RUN = 3;   // 1回の実行で送る通知は最大3通まで（通知疲れを防ぐ）

const GNAME = {
  chotokkyu: '超特急', milk: 'M!LK', superdragon: 'SUPER★DRAGON', sakurashimeji: 'Sakurashimeji',
  onenonly: "ONE N' ONLY", genjibu: '原因は自分にある。', buddiis: 'BUDDiiS', icex: 'ICEx',
  lienel: 'Lienel', iiondo: 'iiONDO',
};
const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// サーバーに作られた今日の実況スレを取得して、通知から直接開けるようにする
async function liveThreads() {
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) return [];
  try {
    const sb = createClient(u, k, { auth: { persistSession: false } });
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const { data } = await sb.from('threads').select('id,title,group_id').eq('live', true).eq('live_date', today);
    return data || [];
  } catch { return []; }
}

function buildNotifications(items, state, threads = []) {
  const today = jstToday();
  const sent = new Set(state.sent || []);
  const out = [];

  // ① 今日の実況スレ（テレビ・ラジオ・イベント）
  const live = items.filter(it => it.kind === 'schedule' && it.date === today && (it.cat === 'media' || it.cat === 'event'));
  const seenTitle = new Set();
  for (const it of live) {
    const name = it.t.replace(/^【[^】]+】/, '').trim();
    if (seenTitle.has(name)) continue;
    seenTitle.add(name);
    const id = `live:${today}:${name}`;
    if (sent.has(id)) continue;
    const th = threads.find(t => t.title === `【実況】${name}`);
    out.push({
      id, type: 'live', g: it.g,
      title: `実況スレが立ちました`,
      body: `${it.g ? GNAME[it.g] + '「' : ''}${name}${it.g ? '」' : ''}　見ながら語りましょう！`,
      url: th ? `${SITE}/#/thread/db${th.id}` : `${SITE}/#/board`,
    });
  }

  // ② 推しグループの新着（公式ニュース・X）
  for (const it of items.filter(x => (x.kind === 'news' || x.kind === 'x') && x.date === today)) {
    const id = `news:${it.id}`;
    if (sent.has(id)) continue;
    if (it.cat === 'other') continue;        // 事務連絡は通知しない
    out.push({
      id, type: 'news', g: it.g,
      title: `${it.g ? GNAME[it.g] : 'EBiDAN'}の新着`,
      body: it.t || '公式Xに新しい投稿があります',
      url: `${SITE}/#/info`,
    });
  }
  return out;
}

// 本人あてのお知らせ（フォローされた等）を取り出す
async function personalNotices() {
  const { SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY } = process.env;
  if (!SB || !KEY) return [];
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await fetch(`${SB}/rest/v1/notices?select=id,user_id,title,body,url&pushed=is.false&user_id=not.is.null&created_at=gte.${since}&limit=50`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!r.ok) return [];
  return r.json();
}
async function markPushed(ids) {
  const { SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY } = process.env;
  if (!ids.length) return;
  await fetch(`${SB}/rest/v1/notices?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushed: true }),
  });
}

async function main() {
  const priv = process.env.VAPID_PRIVATE_KEY, blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!priv || !blobToken) { console.log('通知の鍵または保存先が未設定のため、送信をスキップしました'); return; }

  let state = { sent: [] };
  try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));

  const notis = buildNotifications(items, state, await liveThreads()).slice(0, MAX_PER_RUN);
  const personal = await personalNotices();
  if (!notis.length && !personal.length) { console.log('送る通知はありません'); return; }

  const { blobs } = await list({ prefix: 'subs/', token: blobToken });
  if (!blobs.length) { console.log(`通知対象 ${notis.length} 件ありますが、購読者がまだいません`); }

  webpush.setVapidDetails(SITE.replace(/^https?:\/\//, 'mailto:info@') , VAPID_PUBLIC, priv);

  let ok = 0, gone = 0, personalOk = [];
  for (const b of blobs) {
    let sub;
    try { sub = await (await fetch(b.url, { cache: 'no-store' })).json(); } catch { continue; }
    // その人あてのお知らせ（フォローされた等）
    for (const n of personal.filter(x => sub.userId && x.user_id === sub.userId)) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title: n.title, body: n.body, url: n.url || '/#/inbox', tag: 'notice' + n.id }),
        );
        ok++; personalOk.push(n.id);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await del(b.url, { token: blobToken }); gone++; break; }
      }
    }
    for (const n of notis) {
      if (n.type === 'live' && sub.noti?.live === false) continue;
      if (n.type === 'news' && sub.noti?.news === false) continue;
      if (n.g && sub.follow?.length && !sub.follow.includes(n.g)) continue;   // 推しグループ以外は送らない
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.type }),
        );
        ok++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await del(b.url, { token: blobToken }); gone++; break; }
        console.error('送信エラー', e.statusCode || e.message);
      }
    }
  }

  // 送れたお知らせには印をつける（届かなかったものは次回また試す）
  await markPushed([...new Set(personalOk)]);
  state.sent = [...(state.sent || []), ...notis.map(n => n.id)].slice(-500);
  state.updated = new Date().toISOString();
  await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
  console.log(`通知 ${notis.length} 種類＋本人あて ${personal.length} 件を ${blobs.length} 人へ送信（成功 ${ok} 件、解除済み ${gone} 件）`);
}

main().catch(e => { console.error(e); process.exit(1); });
