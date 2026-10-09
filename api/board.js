// 掲示板の書き込みを受け付けるAPI。
// 書き込みはすべてここを通す（連投制限・NGワード・IPの記録を行うため）。
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;     // サーバー専用の鍵（画面には出さない）
const db = () => createClient(URL_, KEY, { auth: { persistSession: false } });

// ルール違反の書き込みを止める
function ng(text) {
  if (/譲|定価|売ります|買います|求む|チケ.*(交換|取引)/.test(text)) return 'チケットの売買・譲渡に関する書き込みはできません';
  if (/住所|自宅|熱愛|彼女|彼氏|実家/.test(text)) return 'メンバーのプライベートに関する書き込みはできません';
  if (/FC限定|会員限定|有料配信|アーカイブ.*(url|URL|リンク)|違法アップ/.test(text)) return '会員限定・有料コンテンツに関する書き込みはできません';
  if (/(AI|生成AI).{0,6}(作っ|生成|作成)|AIイラスト.*(本人|メンバー)/.test(text)) return 'メンバーを模した生成AIコンテンツの投稿はできません';
  return null;
}
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

// 同じ端末からの連続投稿をおさえる（迷惑投稿対策）
// サーバーは複数台で動くため、直前の書き込み時刻はデータベースで確認する
async function tooFast(sb, clientId, sec = 15) {
  const since = new Date(Date.now() - sec * 1000).toISOString();
  const { data } = await sb.from('post_meta').select('created_at')
    .eq('client_id', clientId).gte('created_at', since).limit(1);
  return !!(data && data.length);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!URL_ || !KEY) return res.status(503).json({ error: 'データベースの設定がまだです' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, clientId } = b;
    if (!clientId) return res.status(400).json({ error: 'clientId が必要です' });
    const sb = db();

    if (action === 'post') {
      const body = String(b.body || '').trim().slice(0, 2000);
      if (!body) return res.status(400).json({ error: '本文が空です' });
      const bad = ng(body);
      if (bad) return res.status(400).json({ error: bad });
      if (await tooFast(sb, clientId)) return res.status(429).json({ error: '少し時間をあけてから書き込んでください（15秒に1回まで）' });

      const threadId = Number(b.threadId);
      const { data: th } = await sb.from('threads').select('id,reply_count,hidden').eq('id', threadId).single();
      if (!th || th.hidden) return res.status(404).json({ error: 'このスレッドは見つかりません' });

      const no = (th.reply_count || 0) + 1;
      const { data: post, error } = await sb.from('posts').insert({
        thread_id: threadId, no, body,
        author_name: String(b.name || '名無しさん').slice(0, 12),
        anon_id: String(b.anonId || '').slice(0, 8),
        user_id: b.userId || null,
      }).select().single();
      if (error) throw error;

      await sb.from('post_meta').insert({ post_id: post.id, client_id: clientId, ip: ipOf(req), user_agent: (req.headers['user-agent'] || '').slice(0, 200) });
      await sb.from('threads').update({ reply_count: no, updated_at: new Date().toISOString() }).eq('id', threadId);
      return res.status(200).json({ ok: true, post });
    }

    if (action === 'thread') {
      const title = String(b.title || '').trim().slice(0, 80);
      const body = String(b.body || '').trim().slice(0, 2000);
      if (!title || !body) return res.status(400).json({ error: 'タイトルと本文を入れてください' });
      const bad = ng(title + body);
      if (bad) return res.status(400).json({ error: bad });
      if (await tooFast(sb, clientId, 60)) return res.status(429).json({ error: 'スレッドを立てるのは1分に1つまでです' });

      const { data: th, error } = await sb.from('threads').insert({
        group_id: b.groupId || null, cat: String(b.cat || '雑談').slice(0, 10), title,
        author_name: String(b.name || '名無しさん').slice(0, 12), user_id: b.userId || null,
      }).select().single();
      if (error) throw error;

      const { data: post } = await sb.from('posts').insert({
        thread_id: th.id, no: 1, body,
        author_name: String(b.name || '名無しさん').slice(0, 12),
        anon_id: String(b.anonId || '').slice(0, 8), user_id: b.userId || null,
      }).select().single();
      if (post) await sb.from('post_meta').insert({ post_id: post.id, client_id: clientId, ip: ipOf(req), user_agent: (req.headers['user-agent'] || '').slice(0, 200) });
      return res.status(200).json({ ok: true, thread: th });
    }

    if (action === 'react') {
      const { postId, kind, on } = b;
      if (!['wakaru', 'suki', 'warota'].includes(kind)) return res.status(400).json({ error: 'kind が不正です' });
      if (on) await sb.from('reactions').upsert({ post_id: postId, kind, client_id: clientId });
      else await sb.from('reactions').delete().match({ post_id: postId, kind, client_id: clientId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'report') {
      const { error } = await sb.from('reports').insert({
        target_type: String(b.targetType || 'post'), target_id: String(b.targetId || ''),
        reason: String(b.reason || '').slice(0, 40), note: String(b.note || '').slice(0, 500),
        reporter: String(b.reporter || clientId).slice(0, 40),
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'サーバー側でエラーが起きました' });
  }
}
