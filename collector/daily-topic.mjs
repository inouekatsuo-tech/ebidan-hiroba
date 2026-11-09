// 毎日「お題スレ」を1本だけ立てる。
//
// ゼロから話題をつくるのは勇気がいるので、運営から話しかける形にして
// 「答えるだけ」で参加できるようにする。今日の出演があればその話題を優先する。
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const ITEMS = new URL('../milkies-hiroba/data/items.json', import.meta.url);
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const KEEP_DAYS = 2;            // 返事のないお題を片づけるまでの日数（並べて置くと寂しく見えるため）
const WD = '日月火水木金土';

const jstNow = () => new Date(Date.now() + 9 * 3600e3);
const clean = t => t.replace(/^【[^】]+】/, '').trim();

// 曜日ごとの定番のお題（誰でも一言で答えられるものにする）
const WEEKLY = [
  ['今週、推しのどこにやられましたか？', 'ひとつだけ教えてください。小さなことでも大歓迎です。'],
  ['はじめましての方、どうぞ', '推しグループと、ハマったきっかけだけでも。名前がなくても書けます。'],
  ['最近かわいかった（かっこよかった）瞬間は？', '番組でも、SNSでも、ライブでも。'],
  ['推し活、いま困っていることありますか？', 'チケット、グッズ、親に言えない…なんでもどうぞ。'],
  ['はじめて好きになった瞬間を覚えていますか？', 'きっかけの話、聞いてみたいです。'],
  ['今週末の予定は？', '参戦する人も、家で見る人も。'],
  ['今日は何を見ますか／聞きますか？', 'おすすめがあれば教えてください。'],
];

function pick(items, today) {
  const d = new Date(today + 'T00:00:00Z');
  const todays = items.filter(it => it.kind === 'schedule' && it.date === today);

  // ライブがある日は、その話題を優先する
  const live = todays.find(it => it.label === 'LiVE&EVENT');
  if (live) return [`今日の「${clean(live.t).slice(0, 24)}」、行く人いますか？`,
    '参戦する人も、行けないけど応援している人も、ここで話しましょう。現地の写真や座席の話は、ルールの範囲でどうぞ。'];

  // テレビ・ラジオがある日は、番組名を出して「一緒に見よう」と誘う
  const tv = todays.filter(it => (it.label === 'TV' || it.label === 'RADiO') && it.time);
  if (tv.length) {
    const t = tv.sort((a, b) => (b.time || '').localeCompare(a.time || ''))[0];   // いちばん遅い＝ゴールデン帯を選ぶ
    return [`今夜の「${clean(t.t).slice(0, 22)}」、見る人いますか？`,
      `${t.time}からです。${tv.length > 1 ? `今日はほかにも${tv.length - 1}件の出演があります。` : ''}実況スレもあるので、一緒に見ましょう。`];
  }
  return WEEKLY[d.getUTCDay()];
}

async function main() {
  if (!URL_ || !KEY) { console.log('データベースの設定がないため、お題スレをスキップしました'); return; }
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
  const now = jstNow(), today = now.toISOString().slice(0, 10);
  const { items } = JSON.parse(await readFile(ITEMS, 'utf8'));

  // 今日のぶんがもうあれば何もしない
  const { data: exist } = await sb.from('threads').select('id')
    .eq('live_date', today).eq('cat', 'お題').maybeSingle();
  if (exist) { console.log('今日のお題スレはすでにあります'); return; }

  const [title, lead] = pick(items, today);
  const { data: th, error } = await sb.from('threads').insert({
    title: `【お題】${title}`, cat: 'お題', live_date: today,
    when_label: `${+today.slice(5, 7)}/${+today.slice(8, 10)}（${WD[new Date(today + 'T00:00:00Z').getUTCDay()]}）`,
    author_name: '広場の運営', reply_count: 1,
  }).select().single();
  if (error) { console.error('お題スレを作れませんでした:', error.message); return; }

  await sb.from('posts').insert({
    thread_id: th.id, no: 1, author_name: '広場の運営', anon_id: 'ositopia',
    body: `${lead}\n\n・名前を入れなくても「名無しさん」として書けます\n・一言だけでも大丈夫です\n・反応だけしたい人は、スタンプを押してください`,
  });

  // 返事がつかなかった古いお題は片づける
  const limit = new Date(now.getTime() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  const { data: old } = await sb.from('threads').select('id')
    .eq('cat', 'お題').lt('live_date', limit).lte('reply_count', 1);
  if (old?.length) {
    await sb.from('threads').delete().in('id', old.map(t => t.id));
    console.log(`古いお題スレを ${old.length} 件片づけました`);
  }
  console.log(`お題スレを作りました: ${title}`);
}

main().catch(e => { console.error(e); process.exit(1); });
