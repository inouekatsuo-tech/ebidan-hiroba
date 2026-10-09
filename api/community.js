// コミュニティとイベント。参加・作成・承認などの操作を受け付ける。
// 本人確認は、アカウントの合言葉（token）で行う。
import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const ng = t => /譲|定価|売ります|買います|チケ.*(交換|取引)|住所|自宅|熱愛/.test(t) ? 'ルールに反する内容が含まれています' : null;

async function me(sb, token) {
  if (!token) return null;
  const { data } = await sb.from('profiles').select('id,handle,age_band,pref,banned,member_no').eq('token', token).maybeSingle();
  return data;
}
// 年齢による参加制限（未成年の保護）
function ageOk(band, user) {
  if (!band) return null;
  const teen = user.age_band === '10代';
  if (band === '10代' && !teen) return '10代の方のみ参加できます';
  if (band === '18歳以上' && teen) return '18歳以上の方のみ参加できます';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const sb = db();
    const u = await me(sb, b.token);
    if (!u) return res.status(401).json({ error: 'ログインが必要です' });
    if (u.banned) return res.status(403).json({ error: 'このアカウントは現在凍結されています' });
    const a = b.action;

    // --- コミュニティを作る ---
    if (a === 'create') {
      const name = String(b.name || '').trim();
      if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'コミュニティ名は2〜30文字で入れてください' });
      const bad = ng(name + (b.description || '')); if (bad) return res.status(400).json({ error: bad });
      const { data, error } = await sb.from('communities').insert({
        name, group_id: b.groupId || null, kind: String(b.kind || 'その他').slice(0, 10),
        description: String(b.description || '').slice(0, 500),
        rules: Array.isArray(b.rules) ? b.rules.slice(0, 10) : [],
        join_type: b.joinType === 'だれでも' ? 'だれでも' : '承認制',
        only_band: b.onlyBand || null, admin_id: u.id, member_count: 1,
      }).select().single();
      if (error) throw error;
      await sb.from('community_members').insert({ community_id: data.id, user_id: u.id, status: 'approved' });
      return res.status(200).json({ ok: true, community: data });
    }

    // --- 参加する／申請する ---
    if (a === 'join') {
      const { data: c } = await sb.from('communities').select('*').eq('id', b.communityId).single();
      if (!c) return res.status(404).json({ error: 'コミュニティが見つかりません' });
      const bad = ageOk(c.only_band, u); if (bad) return res.status(403).json({ error: bad });
      // すでに参加（または申請）しているときは、人数を数え直さない
      const { data: already } = await sb.from('community_members').select('status').match({ community_id: c.id, user_id: u.id }).maybeSingle();
      if (already) return res.status(200).json({ ok: true, status: already.status });
      const status = c.join_type === 'だれでも' ? 'approved' : 'pending';
      await sb.from('community_members').insert({ community_id: c.id, user_id: u.id, status });
      if (status === 'approved') await sb.from('communities').update({ member_count: (c.member_count || 0) + 1 }).eq('id', c.id);
      return res.status(200).json({ ok: true, status });
    }

    // --- 退会／申請の取り消し ---
    if (a === 'leave') {
      const { data: cm } = await sb.from('community_members').select('status').match({ community_id: b.communityId, user_id: u.id }).maybeSingle();
      await sb.from('community_members').delete().match({ community_id: b.communityId, user_id: u.id });
      // 退会したら、そのコミュニティのイベント参加も外す（主催しているものは残す）
      const { data: evs } = await sb.from('events').select('id,joined_count,host_id').eq('community_id', b.communityId);
      for (const ev of evs || []) {
        if (ev.host_id === u.id) continue;
        const { data: gone } = await sb.from('event_members').delete().match({ event_id: ev.id, user_id: u.id }).select();
        if (gone && gone.length) await sb.from('events').update({ joined_count: Math.max(0, (ev.joined_count || 1) - 1) }).eq('id', ev.id);
      }
      if (cm?.status === 'approved') {
        const { data: c } = await sb.from('communities').select('member_count').eq('id', b.communityId).single();
        await sb.from('communities').update({ member_count: Math.max(0, (c?.member_count || 1) - 1) }).eq('id', b.communityId);
      }
      return res.status(200).json({ ok: true });
    }

    // --- 管理人による承認／見送り ---
    if (a === 'approve' || a === 'decline') {
      const { data: c } = await sb.from('communities').select('*').eq('id', b.communityId).single();
      if (!c || c.admin_id !== u.id) return res.status(403).json({ error: '管理人だけが操作できます' });
      if (a === 'approve') {
        const { data: row } = await sb.from('community_members').select('status').match({ community_id: c.id, user_id: b.userId }).maybeSingle();
        if (!row) return res.status(404).json({ error: '申請が見つかりません' });
        if (row.status === 'approved') return res.status(200).json({ ok: true });
        await sb.from('community_members').update({ status: 'approved' }).match({ community_id: c.id, user_id: b.userId });
        await sb.from('communities').update({ member_count: (c.member_count || 0) + 1 }).eq('id', c.id);
      } else {
        await sb.from('community_members').delete().match({ community_id: c.id, user_id: b.userId });
      }
      return res.status(200).json({ ok: true });
    }

    // --- イベントを作る ---
    if (a === 'createEvent') {
      const { data: cm } = await sb.from('community_members').select('status').match({ community_id: b.communityId, user_id: u.id }).maybeSingle();
      if (cm?.status !== 'approved') return res.status(403).json({ error: 'コミュニティに参加している人だけが作れます' });
      const title = String(b.title || '').trim();
      if (!title || !b.date || !b.place || !b.area) return res.status(400).json({ error: 'イベント名・日付・場所・エリアを入れてください' });
      const bad = ng(title + (b.description || '')); if (bad) return res.status(400).json({ error: bad });
      // 10代の人は「10代限定」しか作れない
      const target = u.age_band === '10代' ? '10代限定' : (b.target === '10代限定' ? '10代限定' : '18歳以上');
      const { data, error } = await sb.from('events').insert({
        community_id: b.communityId, title, date: b.date, time: b.time || null,
        place: String(b.place).slice(0, 100), area: String(b.area).slice(0, 50),
        cap: Math.max(2, Math.min(50, Number(b.cap) || 10)),
        target_band: target, description: String(b.description || '').slice(0, 1000),
        host_id: u.id, joined_count: 1,
      }).select().single();
      if (error) throw error;
      await sb.from('event_members').insert({ event_id: data.id, user_id: u.id });
      return res.status(200).json({ ok: true, event: data });
    }

    // --- イベントに参加／取り消し ---
    if (a === 'joinEvent' || a === 'leaveEvent') {
      const { data: ev } = await sb.from('events').select('*').eq('id', b.eventId).single();
      if (!ev) return res.status(404).json({ error: 'イベントが見つかりません' });
      if (a === 'joinEvent') {
        const { data: cm } = await sb.from('community_members').select('status').match({ community_id: ev.community_id, user_id: u.id }).maybeSingle();
        if (cm?.status !== 'approved') return res.status(403).json({ error: 'まずコミュニティに参加してください' });
        const bad = ageOk(ev.target_band === '10代限定' ? '10代' : '18歳以上', u);
        if (bad) return res.status(403).json({ error: ev.target_band === '10代限定' ? 'このイベントは10代限定です' : '安全のため、10代の方は「10代限定」のイベントのみ参加できます' });
        const { data: joined } = await sb.from('event_members').select('user_id').match({ event_id: ev.id, user_id: u.id }).maybeSingle();
        if (joined) return res.status(200).json({ ok: true });
        if ((ev.joined_count || 0) >= ev.cap) return res.status(400).json({ error: '満員です' });
        await sb.from('event_members').insert({ event_id: ev.id, user_id: u.id });
        await sb.from('events').update({ joined_count: (ev.joined_count || 0) + 1 }).eq('id', ev.id);
      } else {
        if (ev.host_id === u.id) return res.status(400).json({ error: '主催者は参加を取り消せません' });
        const { data: gone } = await sb.from('event_members').delete().match({ event_id: ev.id, user_id: u.id }).select();
        if (gone && gone.length) await sb.from('events').update({ joined_count: Math.max(0, (ev.joined_count || 1) - 1) }).eq('id', ev.id);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action が不正です' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'サーバー側でエラーが起きました' });
  }
}
