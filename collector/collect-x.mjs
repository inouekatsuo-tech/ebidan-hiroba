// 公式Xアカウントの新着投稿を集める。
//
// ・1回の実行で「検索APIを1リクエストだけ」使う（from:アカウント名 をORでつなぐ）ので、
//   課金は返ってきた投稿の件数ぶん（1件 約0.005ドル）だけで済む。
// ・投稿の本文はファイルに保存しない（サイトではXの公式埋め込みで表示する）。
//   保存するのは 投稿ID・アカウント・日時・カテゴリ だけ。
// ・環境変数 X_BEARER_TOKEN が無いときは、何もせずに正常終了する。
//
// 使い方: X_BEARER_TOKEN=xxx node collector/collect-x.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { classify } from './collect.mjs';

const OUT = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const CONF = new URL('./x-accounts.json', import.meta.url);
const STATE = new URL('./x-state.json', import.meta.url);
const TOKEN = process.env.X_BEARER_TOKEN;
const MAX = +process.env.X_MAX || 25;        // 1回に取り込む上限
const BUDGET = +process.env.X_BUDGET || 5;   // 1か月に使う上限（ドル）。超えたらその月は取得を止める
const PER_POST = 0.005;                      // 1投稿あたりの目安（ドル）

async function main() {
  if (!TOKEN) { console.log('X_BEARER_TOKEN が未設定のため、Xの収集はスキップしました'); return; }
  const { accounts } = JSON.parse(await readFile(CONF, 'utf8'));
  const byUser = Object.fromEntries(accounts.map(a => [a.user.toLowerCase(), a.g]));

  let state = {};
  try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch {}

  // 今月の使用量チェック（予算を超えたら翌月まで止める）
  const month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  if (state.month !== month) { state.month = month; state.posts = 0; }
  const spent = (state.posts || 0) * PER_POST;
  if (spent >= BUDGET) {
    console.log(`今月のX取得は上限（$${BUDGET}）に達しています。使用 $${spent.toFixed(3)} / ${state.posts}件`);
    return;
  }

  const query = `(${accounts.map(a => `from:${a.user}`).join(' OR ')}) -is:retweet -is:reply`;
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', String(Math.min(Math.max(MAX, 10), 100)));
  url.searchParams.set('tweet.fields', 'created_at,text');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username');
  // 検索APIは直近7日分しか扱えず、それより古い since_id を渡すとエラーになる
  // （予算超過で取得を止めていた月明けなど）。古いときは since_id を使わずに直近分を取り直す。
  const sinceTime = state.since_id ? Number(BigInt(state.since_id) >> 22n) + 1288834974657 : 0;
  if (sinceTime > Date.now() - 6.5 * 86400e3) url.searchParams.set('since_id', state.since_id);
  else if (state.since_id) console.log('前回の取得から7日近くたっているため、直近の投稿から取り直します');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429) { console.log('Xの利用制限にかかりました。次回に回します'); return; }
  if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const tweets = json.data || [];
  if (!tweets.length) { console.log('Xの新着はありません'); return; }

  const users = Object.fromEntries((json.includes?.users || []).map(u => [u.id, u.username]));
  const fresh = tweets.map(t => {
    const user = users[t.author_id] || '';
    return {
      id: `x${t.id}`, kind: 'x', g: byUser[user.toLowerCase()] ?? null,
      cat: classify(t.text),                 // 本文はここで仕分けに使うだけで、保存しない
      t: '', author: user, date: t.created_at.slice(0, 10),
      url: `https://x.com/${user}/status/${t.id}`,
    };
  });

  const data = JSON.parse(await readFile(OUT, 'utf8'));
  const byId = new Map(data.items.map(it => [it.id, it]));
  const seen = new Date().toISOString();
  for (const it of fresh) if (!byId.has(it.id)) byId.set(it.id, { ...it, seen });
  data.items = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  data.updated = seen;
  await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');

  const newest = tweets.reduce((a, t) => (BigInt(t.id) > BigInt(a) ? t.id : a), state.since_id || '0');
  const posts = (state.posts || 0) + fresh.length;
  await writeFile(STATE, JSON.stringify({ since_id: newest, month, posts, updated: seen }, null, 1) + '\n');
  console.log(`Xの投稿を ${fresh.length} 件 取り込みました（おおよそ $${(fresh.length * PER_POST).toFixed(3)}）。今月の合計 ${posts}件 / 約$${(posts * PER_POST).toFixed(2)}（上限 $${BUDGET}）`);
}

main().catch(e => { console.error(e); process.exit(1); });
