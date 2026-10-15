// 出演予定の「時間」を、EBiDAN公式の詳細ページ（og:description）から取り出す。
//
// 本文には「毎週日曜日22時30分～放送」「10月18日(日) 14時00分～」のような書き方が混ざっているので、
// ①その予定の日付と一致する時刻 ②日付に結びついていない定時放送の時刻 の順に採用し、
// どちらでもないもの（別の日の時刻など）は採用しない＝間違った時間を出さないことを優先する。
import { readFile, writeFile } from 'node:fs/promises';

const CACHE = new URL('./times.json', import.meta.url);
const KEEP_DAYS = 10;          // 先何日ぶんの予定の時間を調べるか
const MAX_FETCH = 40;          // 1回の実行で調べる上限（公式サイトに負担をかけない）
const z = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':');

export function pickTime(body, date) {
  const t = z(body).replace(/\s+/g, ' ');
  const [, M, D] = date.split('-').map(Number);
  const repeat = /毎週|隔週|毎月|毎日|レギュラー/.test(t);
  const cand = [];
  for (const m of t.matchAll(/(\d{1,2})(?::|時)(\d{2})?分?/g)) {
    const before = t.slice(Math.max(0, m.index - 26), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/時間|分間|話|巻|位|%|歳|人|曲|枚|円|日|月|周年|名/.test(after)) continue;
    let h = +m[1]; const mi = m[2] ? +m[2] : 0;
    if (/午後/.test(before) && h < 12) h += 12;
    if (h > 29 || mi > 59) continue;
    const dm = [...before.matchAll(/(\d{1,2})月(\d{1,2})日/g)].pop();
    cand.push({
      time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
      tied: !!dm,
      same: !!dm && +dm[1] === M && +dm[2] === D,
    });
  }
  // ①その予定の日付と一致する時刻 → ②日付に結びついていない定時放送の時刻
  //   → ③定時放送で、本文に出てくる時刻が1種類だけのとき（「8月21日22時30分～ ※以降隔週」など）
  const uniq = [...new Set(cand.map(c => c.time))];
  return cand.find(c => c.same)?.time
      || (repeat ? cand.find(c => !c.tied)?.time : null)
      || (repeat && uniq.length === 1 ? uniq[0] : null)
      || null;
}

async function detailText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ositopia-bot/1.0; +https://ositopia.com)' } });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/<meta property="og:description" content="([^"]*)"/);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ') : null;
}

export async function addTimes(items) {
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 9 * 3600e3 + KEEP_DAYS * 86400e3).toISOString().slice(0, 10);

  // 近い日の予定から順に調べる（今日・明日の時間がいちばん大事なため）
  const targets = items
    .filter(it => it.kind === 'schedule' && it.date >= today && it.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date));

  let fetched = 0, found = 0;
  for (const it of targets) {
    if (!(it.id in cache)) {
      if (fetched >= MAX_FETCH) continue;
      fetched++;
      try {
        const body = await detailText(it.url);
        cache[it.id] = body ? pickTime(body, it.date) : null;
      } catch { continue; }                       // 失敗したら次回また試す
      await new Promise(r => setTimeout(r, 300)); // 公式サイトに連続で当てない
    }
    if (cache[it.id]) { it.time = cache[it.id]; found++; }
  }

  // 終わった予定のぶんは捨てる
  const live = new Set(items.map(i => i.id));
  for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
  await writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n');
  console.log(`出演時間: ${found}件に時間あり（今回 ${fetched}件を公式サイトで確認）`);
  return items;
}
