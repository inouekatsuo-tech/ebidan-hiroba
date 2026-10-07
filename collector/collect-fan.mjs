// ファンの投稿のうち「話題になっているもの」だけをXから拾う。
//
// ・1日3回だけ実行し、1回につき最大30件（上限は環境変数で変更可）。
// ・Xの検索は「話題性の高い順（relevancy）」で取得し、
//   そのうち いいね数が基準以上・日本語・公式以外 のものだけ採用する。
// ・投稿の本文は保存しない（サイトではXの公式埋め込みで表示する）。
//   保存するのは 投稿ID・アカウント名・日時・いいね数・グループ・カテゴリ だけ。
//
// 使い方: X_BEARER_TOKEN=xxx node collector/collect-fan.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { classify } from './collect.mjs';

const OUT = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const CONF = new URL('./x-accounts.json', import.meta.url);
const STATE = new URL('./x-state.json', import.meta.url);
const TOKEN = process.env.X_BEARER_TOKEN;
const MAX = +process.env.FAN_MAX || 30;            // 1回に読む件数（この数だけ課金される）
const MIN_LIKES = +process.env.FAN_MIN_LIKES || 20; // 採用するいいね数の下限
const BUDGET = +process.env.X_BUDGET || 5;          // 1か月の上限（ドル）
const PER_POST = 0.005;
const KEEP = 60;                                    // 保存しておく件数の上限

// グループごとの検索語。固有名詞に絞って、関係ない投稿を拾わないようにする
const KEYWORDS = {
  chotokkyu: ['"超特急"'],
  milk: ['"M!LK"', '#MILK'],
  superdragon: ['"SUPER★DRAGON"', '"スパドラ"'],
  sakurashimeji: ['"さくらしめじ"'],
  onenonly: ['"ONE N\' ONLY"', '"ワンエン"'],
  genjibu: ['"原因は自分にある。"', '"げんじぶ"'],
  buddiis: ['"BUDDiiS"'],
  icex: ['"ICEx"'],
  lienel: ['"Lienel"'],
  iiondo: ['"iiONDO"'],
};
// 明らかに関係のない投稿を外す
const NG = /(牛乳|ミルクティー|コンデンスミルク|粉ミルク|ミルクパン|相互フォロー|プレゼント企画|フォロー&?RT|稼げ|副業|エロ|えろ|販売中|DM(ください|下さい))/;

function groupOf(text) {
  for (const [g, words] of Object.entries(KEYWORDS)) {
    for (const w of words) if (text.includes(w.replace(/"/g, '').replace(/^#/, ''))) return g;
  }
  return null;
}

async function main() {
  if (!TOKEN) { console.log('X_BEARER_TOKEN が未設定のため、話題の投稿の取得はスキップしました'); return; }

  const { accounts } = JSON.parse(await readFile(CONF, 'utf8'));
  const officials = new Set(accounts.map(a => a.user.toLowerCase()));

  let state = {};
  try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  const month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  if (state.month !== month) { state.month = month; state.posts = 0; }
  if ((state.posts || 0) * PER_POST >= BUDGET) {
    console.log(`今月のX利用は上限（$${BUDGET}）に達しているため、取得を見送りました`);
    return;
  }

  // 全グループをまとめて1リクエスト（リクエスト数ではなく件数で課金されるため）
  const words = Object.values(KEYWORDS).flat().join(' OR ');
  const query = `(${words}) -is:retweet -is:reply -is:quote lang:ja`;
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', String(Math.min(Math.max(MAX, 10), 100)));
  url.searchParams.set('sort_order', 'relevancy');   // 話題性の高い順
  url.searchParams.set('tweet.fields', 'created_at,text,public_metrics,possibly_sensitive');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,protected');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429) { console.log('Xの利用制限にかかりました。次回に回します'); return; }
  if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const tweets = json.data || [];
  if (!tweets.length) { console.log('該当する投稿はありませんでした'); return; }

  const users = Object.fromEntries((json.includes?.users || []).map(u => [u.id, u]));
  const picked = [];
  for (const t of tweets) {
    const u = users[t.author_id];
    if (!u || u.protected) continue;
    if (officials.has(u.username.toLowerCase())) continue;        // 公式は別で取得しているので除く
    if (t.possibly_sensitive) continue;
    if (NG.test(t.text)) continue;                                 // 宣伝・無関係なものを除く
    const likes = t.public_metrics?.like_count || 0;
    if (likes < MIN_LIKES) continue;
    const g = groupOf(t.text);
    if (!g) continue;
    picked.push({
      id: `f${t.id}`, kind: 'fan', g, cat: classify(t.text),
      t: '', author: u.username, likes,
      date: t.created_at.slice(0, 10),
      url: `https://x.com/${u.username}/status/${t.id}`,
    });
  }

  const data = JSON.parse(await readFile(OUT, 'utf8'));
  const seen = new Date().toISOString();
  const byId = new Map(data.items.map(it => [it.id, it]));
  let added = 0;
  for (const it of picked) {
    const old = byId.get(it.id);
    byId.set(it.id, { ...it, seen: old?.seen || seen });
    if (!old) added++;
  }

  // 古い・いいねの少ない「話題の投稿」は整理して、最大 KEEP 件だけ残す
  const all = [...byId.values()];
  const fans = all.filter(x => x.kind === 'fan').sort((a, b) => b.date.localeCompare(a.date) || b.likes - a.likes).slice(0, KEEP);
  const keepIds = new Set(fans.map(f => f.id));
  data.items = all.filter(x => x.kind !== 'fan' || keepIds.has(x.id))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
  data.updated = seen;
  await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');

  const posts = (state.posts || 0) + tweets.length;
  await writeFile(STATE, JSON.stringify({ ...state, month, posts, updated: seen }, null, 1) + '\n');
  console.log(`話題の投稿：${tweets.length}件読み込み → 採用 ${picked.length}件（新規 ${added}件）。` +
    `今回 約$${(tweets.length * PER_POST).toFixed(3)}／今月 ${posts}件 約$${(posts * PER_POST).toFixed(2)}（上限 $${BUDGET}）`);
}

main().catch(e => { console.error(e); process.exit(1); });
