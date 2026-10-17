// EBiDANの出演情報を、1日2回Xに自動投稿する。
//   朝（7:00）  … 今日の出演まとめ
//   夕（16:00） … 今夜の出演（18時以降）。実況スレへの誘導つき。無ければ今日の新着情報。
//
// ・本文にURLは入れない（Xの課金が1投稿 $0.015 → URL入りだと $0.20 になるため。
//   リンクはプロフィールに置いてあるので、そちらへ誘導する）
// ・同じ日に二重投稿しないよう、投稿した日付を記録する
// ・DRY=1 を付けると、投稿せずに本文だけ表示する
//
// 使い方: DRY=1 node collector/x-post.mjs
import { readFile } from 'node:fs/promises';

const ITEMS = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const { SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY, X_CLIENT_ID, X_CLIENT_SECRET } = process.env;
const DRY = process.env.DRY === '1';
const MODE = ['noon', 'evening'].includes(process.env.MODE) ? process.env.MODE : 'morning';
const LIMIT = 280;                    // Xの上限（日本語は1文字=2）

const GROUP = {
  chotokkyu: { name: '超特急', tag: '超特急', fan: '8号車' },
  milk: { name: 'M!LK', tag: 'MILK', fan: 'みるきーず' },
  superdragon: { name: 'スパドラ', tag: 'スパドラ' },
  sakurashimeji: { name: 'さくらしめじ', tag: 'さくらしめじ' },
  onenonly: { name: "ONE N' ONLY", tag: 'ワンエン' },
  genjibu: { name: 'げんじぶ', tag: 'げんじぶ' },
  buddiis: { name: 'BUDDiiS', tag: 'BUDDiiS' },
  icex: { name: 'ICEx', tag: 'ICEx' },
  lienel: { name: 'Lienel', tag: 'Lienel' },
  iiondo: { name: 'iiONDO', tag: 'iiONDO' },
};
// 見出しの絵文字と、紹介する順番（ライブや誕生日を先に）
const LABEL = {
  BiRTHDAY: ['🎂', 0], 'LiVE&EVENT': ['🎤', 1], STAGE: ['🎭', 2], MOViE: ['🎬', 3],
  TV: ['📺', 4], RADiO: ['📻', 5], MAG: ['📖', 6], OTHER: ['✨', 7],
};
const WD = '日月火水木金土';
const len = t => [...t].reduce((n, c) => n + (c.codePointAt(0) < 0x1100 ? 1 : 2), 0);
const cut = (t, max) => { let o = '', n = 0; for (const c of t) { const w = c.codePointAt(0) < 0x1100 ? 1 : 2; if (n + w > max) return o + '…'; o += c; n += w; } return o; };

// ===== 本文をつくる =====
export function buildText(items, today, mode = 'morning', nowHM = '00:00') {
  const [Y, M, D] = today.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()];
  const noon = mode === 'noon', evening = mode === 'evening';
  const head = `【${M}/${D}(${wd})】` +
    (evening ? '今夜の出演' : noon ? 'このあとの出演' : '今日の出演まとめ');

  let todays = items.filter(it => it.kind === 'schedule' && it.date === today);
  // 昼・夕の回は、まだ始まっていないものだけ（時間が分からないものは出さない）
  if (noon) todays = todays.filter(it => it.time && it.time > nowHM);
  if (evening) todays = todays.filter(it => it.time && it.time > nowHM && it.time >= '18:00');
  // 夜の出演がない日は、代わりに今日の公式の新着をお知らせする
  if (!todays.length) return (noon || evening) ? newsText(items, today, M, D, wd) : null;

  // 同じ番組に複数グループが出るときは1行にまとめる
  const merged = new Map();
  for (const it of todays) {
    const key = it.t.replace(/\s+/g, '');
    const cur = merged.get(key);
    if (cur) { if (!cur.gs.includes(it.g)) cur.gs.push(it.g); }
    else merged.set(key, { ...it, gs: [it.g] });
  }
  // 時間の早い順。時間が分からないものは後ろへ（種類の順＝ライブ・誕生日を先に）
  const all = [...merged.values()];
  const order = all.sort((a, b) =>
    (a.time ? 0 : 1) - (b.time ? 0 : 1) ||
    (a.time || '').localeCompare(b.time || '') ||
    (LABEL[a.label]?.[1] ?? 9) - (LABEL[b.label]?.[1] ?? 9));

  const gs = [...new Set(all.flatMap(it => it.gs).filter(Boolean))];
  const tags = ['EBiDAN',
    ...gs.map(g => GROUP[g]?.tag).filter(Boolean).slice(0, 2),
    ...gs.map(g => GROUP[g]?.fan).filter(Boolean).slice(0, 1)];
  const lead = evening ? '実況スレで一緒に見られます（プロフのリンク）' : '全部は推しトピアで（プロフのリンク）';
  const foot = `\n\n${lead}\n${tags.map(t => '#' + t).join(' ')}`;

  const lines = [];
  let used = len(head) + len(foot) + len('\n\n…ほか00件');
  for (const it of order) {
    if (lines.length >= 6) break;
    const [emoji] = LABEL[it.label] || ['✨'];
    // グループの指定がない予定（合同出演など）は「EBiDAN」とまとめて書く
    const names = it.gs.map(g => GROUP[g]?.name).filter(Boolean).join('・') || 'EBiDAN';
    const title = cut(it.t.replace(/\s+/g, ' ').trim(), it.time ? 30 : 36);
    const line = `${it.time ? it.time + ' ' : ''}${emoji}${names ? names + ' ' : ''}${title}`;
    if (used + len(line) + 1 > LIMIT) break;
    lines.push(line);
    used += len(line) + 1;
  }
  const rest = order.length - lines.length;
  return head + '\n\n' + lines.join('\n') + (rest > 0 ? `\n…ほか${rest}件` : '') + foot;
}

// このあとの出演が無い日は、今日公開された公式の新着をお知らせする
function newsText(items, today, M, D, wd) {
  const news = items.filter(it => (it.kind === 'news' || it.kind === 'video') && it.date === today);
  if (!news.length) return null;
  const head = `【${M}/${D}(${wd})】今日の公式の新着`;
  const tags = [...new Set(news.map(it => GROUP[it.g]?.tag).filter(Boolean))].slice(0, 2);
  const foot = `\n\n続きは推しトピアで（プロフのリンク）\n#EBiDAN ${tags.map(t => '#' + t).join(' ')}`;
  const lines = [];
  let used = len(head) + len(foot) + len('\n\n…ほか00件');
  for (const it of news) {
    if (lines.length >= 5) break;
    const g = GROUP[it.g]?.name;
    const line = `📰${g ? g + ' ' : ''}${cut(it.t.replace(/\s+/g, ' ').trim(), 40)}`;
    if (used + len(line) + 1 > LIMIT) break;
    lines.push(line); used += len(line) + 1;
  }
  if (!lines.length) return null;
  const rest = news.length - lines.length;
  return head + '\n\n' + lines.join('\n') + (rest > 0 ? `\n…ほか${rest}件` : '') + foot;
}

// ===== 保存（サーバーだけが読める tokens 表） =====
const sbHeaders = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function load(key) {
  const r = await fetch(`${SB}/rest/v1/tokens?select=value&key=eq.${key}`, { headers: sbHeaders });
  if (!r.ok) throw new Error('tokens の読み込みに失敗 ' + r.status);
  const j = await r.json();
  return j[0]?.value || null;
}
async function save(key, value) {
  const r = await fetch(`${SB}/rest/v1/tokens`, {
    method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('tokens の保存に失敗 ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

// 合言葉（refresh token）は一度きりの使い捨てなので、使うたびに新しいものを保存する
async function accessToken() {
  const auth = await load('x_auth');
  if (!auth?.refresh) throw new Error('Xの認証がまだです。tools/x-authorize.mjs を実行してください');
  const r = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: X_CLIENT_ID }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('合言葉の更新に失敗 ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  await save('x_auth', { refresh: j.refresh_token || auth.refresh });
  return j.access_token;
}

async function main() {
  const jst = new Date(Date.now() + 9 * 3600e3);
  const today = jst.toISOString().slice(0, 10);
  const nowHM = jst.toISOString().slice(11, 16);
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));
  const text = buildText(items, today, MODE, nowHM);
  if (!text) { console.log(`お知らせすることがないため、投稿しません（${MODE}）`); return; }

  console.log('--- 投稿する本文 ---\n' + text + `\n--- ${len(text)}/${LIMIT} ---`);
  if (DRY) { console.log('DRY=1 のため、投稿はしませんでした'); return; }

  const state = (await load('x_post')) || {};
  const key = { noon: 'lastNoon', evening: 'lastEvening' }[MODE] || 'last';
  if (state[key] === today) { console.log(`今日の${{ noon: '昼', evening: '夕方' }[MODE] || '朝'}の分は投稿済みです`); return; }

  const r = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('投稿に失敗 ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  await save('x_post', { ...state, [key]: today, id: j.data?.id });
  console.log('投稿しました https://x.com/milkies_papa/status/' + j.data?.id);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
