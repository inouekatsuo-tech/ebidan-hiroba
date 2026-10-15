// 「今日のスタダ男子の出演まとめ」を、1日1回Xに自動投稿する。
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
const LIMIT = 280;                    // Xの上限（日本語は1文字=2）

const GROUP = {
  chotokkyu: { name: '超特急', tag: '超特急' },
  milk: { name: 'M!LK', tag: 'MILK' },
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
export function buildText(items, today) {
  const [Y, M, D] = today.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()];
  const head = `【${M}/${D}(${wd})】今日の出演まとめ`;

  const todays = items.filter(it => it.kind === 'schedule' && it.date === today);
  if (!todays.length) return null;

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

  const tags = [...new Set(all.flatMap(it => it.gs).map(g => GROUP[g]?.tag).filter(Boolean))].slice(0, 2);
  const foot = `\n\n全部は推しトピアで（プロフのリンク）\n#EBiDAN ${tags.map(t => '#' + t).join(' ')}`;

  const lines = [];
  let used = len(head) + len(foot) + len('\n\n…ほか00件');
  for (const it of order) {
    if (lines.length >= 6) break;
    const [emoji] = LABEL[it.label] || ['✨'];
    // グループの指定がない予定（合同出演など）は「スタダ男子」とまとめて書く
    const names = it.gs.map(g => GROUP[g]?.name).filter(Boolean).join('・') || 'スタダ男子';
    const title = cut(it.t.replace(/\s+/g, ' ').trim(), it.time ? 30 : 36);
    const line = `${it.time ? it.time + ' ' : ''}${emoji}${names ? names + ' ' : ''}${title}`;
    if (used + len(line) + 1 > LIMIT) break;
    lines.push(line);
    used += len(line) + 1;
  }
  const rest = order.length - lines.length;
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
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));
  const text = buildText(items, today);
  if (!text) { console.log('今日の出演情報がないため、投稿しません'); return; }

  console.log('--- 投稿する本文 ---\n' + text + `\n--- ${len(text)}/${LIMIT} ---`);
  if (DRY) { console.log('DRY=1 のため、投稿はしませんでした'); return; }

  const state = (await load('x_post')) || {};
  if (state.last === today) { console.log('今日はすでに投稿済みです'); return; }

  const r = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('投稿に失敗 ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  await save('x_post', { last: today, id: j.data?.id });
  console.log('投稿しました https://x.com/milkies_papa/status/' + j.data?.id);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
