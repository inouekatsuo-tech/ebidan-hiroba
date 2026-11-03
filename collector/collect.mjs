// EBiDAN公式サイトからニュース・動画・スケジュールを集めて、
// グループ×カテゴリに仕分けた items.json を書き出す。
// 取得するのはタイトル・日付・リンク・公式カテゴリのみ（本文や画像はコピーしない）。
//
// 使い方: node collector/collect.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { addTimes } from './times.mjs';
import { addVideoIds } from './yt.mjs';
import { fetchChannelVideos, mergeVideos } from './yt-feed.mjs';
import { dirname } from 'node:path';

const BASE = 'https://ebidan.jp';
const OUT = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; ebidan-hiroba-bot/1.0; unofficial fan site; +https://ositopia.com)';
const NEWS_PAGES = +process.env.NEWS_PAGES || 3; // 1ページ約12件。30分ごとに直近3ページを見る
const KEEP_DAYS = 45;
const HEALTH = new URL('./collect-health.json', import.meta.url);   // 連続失敗の回数を覚えておく
const MAX_TRANSIENT = 6;   // 30分おきなので、約3時間ずっと落ちていたら知らせる          // これより古いニュースは捨てる

const GROUP_BY_TAG = {
  '超特急': 'chotokkyu', 'M!LK': 'milk', 'SUPER★DRAGON': 'superdragon',
  'Sakurashimeji': 'sakurashimeji', 'さくらしめじ': 'sakurashimeji',
  "ONE N' ONLY": 'onenonly', '原因は自分にある。': 'genjibu', 'BUDDiiS': 'buddiis',
  'ICEx': 'icex', 'Lienel': 'lienel', 'iiONDO': 'iiondo', 'EBiDAN': null,
};

// 公式スケジュールのカテゴリ → サイトのカテゴリ
const SCHEDULE_CAT = {
  'TV': 'media', 'RADiO': 'media', 'MAG': 'media', 'MOViE': 'media', 'WEB': 'media',
  'LiVE&EVENT': 'event', 'STAGE': 'event', 'BiRTHDAY': 'other', 'OTHER': null,
};

// キーワードでの仕分け（上から順に判定。どれにも当たらなければ「お知らせ」）
const RULES = [
  ['other',   /お詫び|誹謗中傷|迷惑行為|注意喚起|なりすまし|お問い合わせ/],
  ['goods',   /グッズ|STORE|ストア|ショップ|SHOP|カプセルトイ|くじ|アクスタ|アクリル|写真集|フォトブック|カレンダー|ラッキードロー|受注|コラボカフェ|ポップアップ|POP UP|物販/i],
  ['event',   /イベント|ライブ|LIVE|ツアー|TOUR|公演|ファンミ|お話し会|握手|サイン会|チケット|抽選|開催|舞台|観覧|フェス|FES/i],
  ['media',   /出演|放送|番組|ラジオ|RADIO|雑誌|掲載|表紙|ドラマ|映画|CM|テレビ|TV|Netflix|シリーズ|配信番組|連載|インタビュー|YouTube|Web|WEB/i],
  ['release', /発売|リリース|シングル|アルバム|ALBUM|SINGLE|配信開始|先行配信|MV|MUSIC VIDEO|ジャケット|新曲|楽曲|収録/i],
];
export function classify(title) {
  for (const [cat, re] of RULES) if (re.test(title)) return cat;
  return 'other';
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const clean = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const ymd = d => d.replace(/\./g, '-');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 相手のサイトが一時的に不調なことがあるので、少し待って3回まで試す
class Transient extends Error {}
async function get(path, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(20000) });
      if (res.ok) { await sleep(800); return res.text(); }       // 負荷をかけないよう間隔をあける
      last = new Error(`${res.status} ${path}`);
      if (res.status < 500 && res.status !== 429) break;          // 404などは再試行しても無駄
    } catch (e) { last = e; }
    if (i < tries) { console.log(`取得に失敗（${last.message}）。${i * 5}秒待って再試行します`); await sleep(i * 5000); }
  }
  throw new Transient(`${last.message}（3回試しても取得できませんでした）`);
}

function groupFromTitle(title) {
  for (const [tag, id] of Object.entries(GROUP_BY_TAG)) if (id && title.includes(tag)) return id;
  return null;
}

async function news() {
  const out = [];
  for (let p = 1; p <= NEWS_PAGES; p++) {
    const html = await get(`/news/list/1/4/?page=${p}&tag=`);
    const re = /<a href="(\/news\/detail\/\d+)" class="clearfix">([\s\S]*?)<\/a>/g;
    for (const [, href, body] of html.matchAll(re)) {
      const date = (body.match(/<p class="date">\s*([\d.]+)\s*<\/p>/) || [])[1];
      const title = clean((body.match(/<p class="tit">([\s\S]*?)<\/p>/) || [])[1] || '');
      const tags = [...body.matchAll(/<p class="tag tag-group[^"]*">([^<]+)<\/p>/g)].map(m => decode(m[1].trim()));
      if (!date || !title) continue;
      const groups = tags.map(t => GROUP_BY_TAG[t]).filter(g => g !== undefined);
      const gs = groups.length ? [...new Set(groups)] : [groupFromTitle(title)];
      for (const g of gs) out.push({ id: `n${href.split('/').pop()}-${g || 'all'}`, kind: 'news', g, cat: classify(title), t: title, date: ymd(date), url: BASE + href });
    }
  }
  return out;
}

async function videos() {
  const html = await get('/news/list/1/12/?tag=');
  const re = /<a href="(\/news\/detail\/\d+)">[\s\S]*?<p class="date">([\d.]+)<\/p>\s*<p class="tit">([\s\S]*?)<\/p>/g;
  return [...html.matchAll(re)].map(([, href, date, t]) => {
    const title = clean(t);
    return { id: `v${href.split('/').pop()}`, kind: 'video', g: groupFromTitle(title), cat: /MV|MUSIC VIDEO/i.test(title) ? 'release' : 'media', t: title, date: ymd(date), url: BASE + href };
  });
}

async function schedule(year, month) {
  const html = await get(`/schedule/calender/${year}/${month}/?tag=0`);
  const out = [];
  const days = html.split('<div class="schedule-modal-wrap" id="').slice(1);
  for (const chunk of days) {
    const date = chunk.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const [, href, body] of chunk.matchAll(/<div class="schedule-block">\s*<a href="(\/schedule\/detail\/\d+)">([\s\S]*?)<\/a>/g)) {
      const title = clean((body.match(/<p class="tit">([\s\S]*?)<\/p>/) || [])[1] || '');
      const label = decode(((body.match(/<span class="cat cat\d+">([^<]+)<\/span>/) || [])[1] || '').trim());
      const tags = [...body.matchAll(/<p class="tag tag-group[^"]*"[^>]*>([^<]+)<\/p>/g)].map(m => decode(m[1].trim()));
      if (!title) continue;
      const gs = tags.map(t => GROUP_BY_TAG[t]).filter(g => g !== undefined);
      for (const g of (gs.length ? [...new Set(gs)] : [null])) {
        out.push({ id: `s${href.split('/').pop()}-${date}-${g || 'all'}`, kind: 'schedule', g, cat: SCHEDULE_CAT[label] ?? classify(title), label, t: title, date, url: BASE + href });
      }
    }
  }
  return out;
}

async function main() {
  const now = new Date(Date.now() + 9 * 3600e3); // JST
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];

  let prev = { items: [] };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

  const fresh = [...await news(), ...await videos(), ...await schedule(y, m), ...await schedule(ny, nm)];
  // 各グループの公式YouTubeの新着（RSS）
  let ytFresh = [];
  try { ytFresh = await fetchChannelVideos(); } catch (e) { console.log('YouTubeの取得でエラー:', e.message); }
  const counts = fresh.reduce((a, it) => (a[it.kind] = (a[it.kind] || 0) + 1, a), {});
  // どれか1種類でも0件なら、サイトの構成が変わった可能性が高いので失敗扱いにする（GitHubから通知が届く）
  for (const k of ['news', 'video', 'schedule']) if (!counts[k]) throw new Error(`${k} が0件でした。公式サイトの構成が変わった可能性があります`);

  // 今月・来月のスケジュールは取り直した内容で置き換え、ニュースは過去分とマージ
  const refreshed = new Set([`${y}-${String(m).padStart(2, '0')}`, `${ny}-${String(nm).padStart(2, '0')}`]);
  const keep = prev.items.filter(it => !(it.kind === 'schedule' && refreshed.has(it.date.slice(0, 7))));
  const byId = new Map(keep.map(it => [it.id, it]));
  const firstSeen = new Date().toISOString();
  for (const it of fresh) {
    const old = byId.get(it.id);
    // 一度わかった出演時間は、日が過ぎても消さない
    byId.set(it.id, { ...it, seen: old?.seen || firstSeen, ...(old?.time ? { time: old.time } : {}), ...(old?.yt ? { yt: old.yt } : {}) });
  }

  // YouTubeの新着を足す（公式サイト由来の動画と重複しないもの）
  for (const v of mergeVideos([...byId.values()], ytFresh)) {
    if (!byId.has(v.id)) byId.set(v.id, { ...v, seen: firstSeen });
  }

  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  // 終わった出演予定は残しても見る人がいないので、3日で片づける（一覧が重くならないように）
  const schedCutoff = new Date(now.getTime() - 3 * 86400e3).toISOString().slice(0, 10);
  // 動画（MVなど）は古くなっても価値があるので長く残す
  const videoCutoff = new Date(now.getTime() - 400 * 86400e3).toISOString().slice(0, 10);
  const items = [...byId.values()]
    .filter(it => it.date >= (it.kind === 'schedule' ? schedCutoff : it.kind === 'video' ? videoCutoff : cutoff))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  // 近い日の予定は、詳細ページから放送・開演の時間を拾って足す
  try { await addTimes(items); } catch (e) { console.log('出演時間の取得でエラー（次回に回します）:', e.message); }
  try { await addVideoIds(items); } catch (e) { console.log('動画IDの取得でエラー（次回に回します）:', e.message); }

  await writeFile(HEALTH, JSON.stringify({ transient: 0, ok: new Date().toISOString() }, null, 1) + '\n');

  const same = JSON.stringify(items) === JSON.stringify(prev.items);
  if (same) { console.log('変化なし', counts); return; }
  await mkdir(dirname(OUT.pathname), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: BASE, items }, null, 1) + '\n');
  console.log('更新しました', counts, '合計', items.length);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(async e => {
  if (e instanceof Transient) {
    let h = { transient: 0 };
    try { h = JSON.parse(await readFile(HEALTH, 'utf8')); } catch {}
    h.transient = (h.transient || 0) + 1;
    h.last = new Date().toISOString();
    try { await writeFile(HEALTH, JSON.stringify(h, null, 1) + '\n'); } catch {}
    if (h.transient >= MAX_TRANSIENT) {
      console.error(`公式サイトに ${h.transient} 回連続でつながりません。サイトの移転や構成変更かもしれません: ${e.message}`);
      process.exit(1);   // ここで初めて失敗通知を出す
    }
    console.log(`公式サイトが一時的に応答しませんでした（連続 ${h.transient} 回目）。次回の実行で取り直します`);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
