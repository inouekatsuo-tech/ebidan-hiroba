// 公式動画のニュースページから YouTube の動画IDを取り出す。
// サムネイル画像を出すためだけに使う（動画そのものはYouTubeで見てもらう）。
import { readFile, writeFile } from 'node:fs/promises';

const CACHE = new URL('./yt.json', import.meta.url);
const MAX_FETCH = 25;

export function pickId(html) {
  // ページの説明に動画IDがそのまま入っていることが多い
  const og = html.match(/<meta property="og:description" content="([A-Za-z0-9_-]{11})"/);
  if (og) return og[1];
  const em = html.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/)
    || html.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
    || html.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/);
  return em ? em[1] : null;
}

export async function addVideoIds(items) {
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}

  let fetched = 0, found = 0;
  const targets = items.filter(it => it.kind === 'video')
    .sort((a, b) => b.date.localeCompare(a.date));   // 新しい動画から調べる

  for (const it of targets) {
    if (!(it.id in cache)) {
      if (fetched >= MAX_FETCH) continue;
      fetched++;
      try {
        const r = await fetch(it.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ositopia-bot/1.0; +https://ositopia.com)' } });
        cache[it.id] = r.ok ? pickId(await r.text()) : null;
      } catch { continue; }
      await new Promise(r => setTimeout(r, 300));
    }
    if (cache[it.id]) { it.yt = cache[it.id]; found++; }
  }

  const live = new Set(items.map(i => i.id));
  for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
  await writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n');
  console.log(`動画: ${found}件にサムネイルあり（今回 ${fetched}件を確認）`);
  return items;
}
