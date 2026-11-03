// 各グループの公式YouTubeチャンネルの新着動画を集める。
// YouTubeが公開しているRSS（APIキー不要・無料）を読むだけ。
import { readFile } from 'node:fs/promises';

const CONF = new URL('./yt-channels.json', import.meta.url);
const PER_CHANNEL = +process.env.YT_PER_CHANNEL || 6;   // 1チャンネルあたり残す本数
const KEEP_DAYS = 400;

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// 動画の内容からカテゴリを推測する
function catOf(title) {
  if (/MUSIC VIDEO|MV|Teaser|ティーザー|Trailer|リリック|Lyric/i.test(title)) return 'release';
  if (/LIVE|ライブ|ツアー|公演|ダイジェスト/i.test(title)) return 'event';
  if (/グッズ|GOODS/i.test(title)) return 'goods';
  return 'media';
}

export async function fetchChannelVideos() {
  const conf = JSON.parse(await readFile(CONF, 'utf8'));
  const since = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  const out = [];

  for (const [g, c] of Object.entries(conf)) {
    try {
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channel}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ositopia-bot/1.0; +https://ositopia.com)' } });
      if (!r.ok) { console.log(`  ${g}: 取得できませんでした (${r.status})`); continue; }
      const xml = await r.text();
      const entries = xml.split('<entry>').slice(1, PER_CHANNEL + 1);
      let n = 0;
      for (const e of entries) {
        const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
        const title = decode((e.match(/<title>([^<]*)<\/title>/) || [])[1] || '').trim();
        const date = ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || '').slice(0, 10);
        if (!id || !title || date < since) continue;
        out.push({
          id: `yt${id}`, kind: 'video', g: g === 'all' ? null : g, cat: catOf(title),
          t: title, date, url: `https://www.youtube.com/watch?v=${id}`, yt: id,
        });
        n++;
      }
      console.log(`  ${g}: ${n}本`);
      await new Promise(s => setTimeout(s, 250));
    } catch (e) { console.log(`  ${g}: エラー ${e.message}`); }
  }
  return out;
}

// 公式サイト由来の動画と重ならないようにまとめる
export function mergeVideos(items, fresh) {
  const have = new Set(items.filter(i => i.yt).map(i => i.yt));
  const add = fresh.filter(v => !have.has(v.yt));
  console.log(`YouTube: ${fresh.length}本を確認 → 新しく追加 ${add.length}本`);
  return add;
}
