// 今日の出演予定から「実況スレ」をサーバー側に作る。
// 全員が同じスレッドに書き込めるようにするため、端末ごとではなくここで一括して作る。
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const ITEMS = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_PER_DAY = 8;          // 1日に作る実況スレの上限
const KEEP_DAYS = 3;            // 書き込みのない実況スレを片づけるまでの日数

const jst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const clean = t => t.replace(/^【[^】]+】/, '').trim();

async function main() {
  if (!URL_ || !KEY) { console.log('データベースの設定がないため、実況スレの作成をスキップしました'); return; }
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
  const today = jst();
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));

  // 今日のテレビ・ラジオ・イベントを、番組名でまとめる
  const seen = new Map();
  for (const it of items) {
    if (it.kind !== 'schedule' || it.date !== today) continue;
    if (it.cat !== 'media' && it.cat !== 'event') continue;
    const name = clean(it.t);
    if (!name) continue;
    const e = seen.get(name) || { name, groups: [], label: it.label || '', url: it.url };
    if (it.g && !e.groups.includes(it.g)) e.groups.push(it.g);
    seen.set(name, e);
  }
  const live = [...seen.values()].slice(0, MAX_PER_DAY);
  if (!live.length) { console.log('今日は実況スレの対象がありません'); return; }

  let made = 0;
  for (const e of live) {
    const title = `【実況】${e.name}`;
    const { data: exist } = await sb.from('threads').select('id').eq('title', title).eq('live_date', today).maybeSingle();
    if (exist) continue;

    const { data: th, error } = await sb.from('threads').insert({
      title, live: true, live_date: today, group_id: e.groups[0] || null, groups: e.groups,
      cat: '実況', src_url: e.url, when_label: today.slice(5).replace('-', '/'),
      author_name: '広場の運営', reply_count: 1,
    }).select().single();
    if (error) { console.error('作成できませんでした:', title, error.message); continue; }

    await sb.from('posts').insert({
      thread_id: th.id, no: 1, author_name: '広場の運営', anon_id: 'system',
      body: 'このスレッドは出演情報から自動で立ちました。\n見ながらの実況・感想をどうぞ！\n\n'
        + '※放送前の内容（ネタバレ）は伏せてください\n'
        + '※チケットの売買・譲渡、メンバーのプライベートの話は禁止です',
    });
    made++;
  }

  // 書き込みのない古い実況スレを片づける
  const old = new Date(Date.now() + 9 * 3600e3 - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  const { data: stale } = await sb.from('threads').select('id').eq('live', true).lt('live_date', old).lte('reply_count', 1);
  if (stale?.length) {
    await sb.from('threads').delete().in('id', stale.map(s => s.id));
  }
  console.log(`実況スレ：新規 ${made}件／本日の対象 ${live.length}件／片づけ ${stale?.length || 0}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
