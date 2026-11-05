// 登録されている端末へ、確認用の通知を1通だけ送る。
// 使い方: VAPID_PRIVATE_KEY=... VAPID_PUBLIC=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node collector/push-test.mjs "本文"
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const SITE = 'https://ositopia.com';
const body = process.argv[2] || '通知のテストです。これが見えていれば成功です 🎉';
const { VAPID_PRIVATE_KEY: priv, VAPID_PUBLIC: pub, SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = process.env;

if (!priv || !pub || !url || !key) { console.error('環境変数が足りません'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });
webpush.setVapidDetails('mailto:info@ositopia.com', pub, priv);

const { data: subs } = await sb.from('push_subs').select('endpoint,keys').limit(500);
if (!subs?.length) { console.log('登録されている端末がありません'); process.exit(0); }

let ok = 0, gone = 0;
for (const s of subs) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys },
      JSON.stringify({ title: '推しトピア', body, url: `${SITE}/#/home`, tag: 'test' }));
    ok++;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await sb.from('push_subs').delete().eq('endpoint', s.endpoint); gone++; }
    else console.error('送信エラー', e.statusCode || e.message);
  }
}
console.log(`${subs.length}件中 ${ok}件に送信しました（解除済み ${gone}件を整理）`);
