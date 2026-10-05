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

const ITEMS = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const STATE = new URL('./push-state.json', import.meta.url);
const SITE = process.env.SITE_URL || 'https://ositopia.com';
const VAPID_PUBLIC = 'BBrg_UQ1b9l-BGpztBQmAnhQroZDk8NaZHuG-es6Wx4m_HKfEJhBkURR8IZuIv-dGOQArskgBFJsL_bnpMs9rxU';
const MAX_PER_RUN = 3;   // 1回の実行で送る通知は最大3通まで（通知疲れを防ぐ）

const GNAME = {
  chotokkyu: '超特急', milk: 'M!LK', superdragon: 'SUPER★DRAGON', sakurashimeji: 'さくらしめじ',
  onenonly: "ONE N' ONLY", genjibu: '原因は自分にある。', buddiis: 'BUDDiiS', icex: 'ICEx',
  lienel: 'Lienel', iiondo: 'iiONDO',
};
const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function buildNotifications(items, state) {
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
    out.push({
      id, type: 'live', g: it.g,
      title: `実況スレが立ちました`,
      body: `${it.g ? GNAME[it.g] + '「' : ''}${name}${it.g ? '」' : ''}　見ながら語りましょう！`,
      url: `${SITE}/#/board`,
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

async function main() {
  const priv = process.env.VAPID_PRIVATE_KEY, blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!priv || !blobToken) { console.log('通知の鍵または保存先が未設定のため、送信をスキップしました'); return; }

  let state = { sent: [] };
  try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));

  const notis = buildNotifications(items, state).slice(0, MAX_PER_RUN);
  if (!notis.length) { console.log('送る通知はありません'); return; }

  const { blobs } = await list({ prefix: 'subs/', token: blobToken });
  if (!blobs.length) { console.log(`通知対象 ${notis.length} 件ありますが、購読者がまだいません`); }

  webpush.setVapidDetails(SITE.replace(/^https?:\/\//, 'mailto:info@') , VAPID_PUBLIC, priv);

  let ok = 0, gone = 0;
  for (const b of blobs) {
    let sub;
    try { sub = await (await fetch(b.url, { cache: 'no-store' })).json(); } catch { continue; }
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

  state.sent = [...(state.sent || []), ...notis.map(n => n.id)].slice(-500);
  state.updated = new Date().toISOString();
  await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
  console.log(`通知 ${notis.length} 種類を ${blobs.length} 人へ送信（成功 ${ok} 件、解除済み ${gone} 件）`);
}

main().catch(e => { console.error(e); process.exit(1); });
