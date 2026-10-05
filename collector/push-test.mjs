// 登録されている端末へ、確認用の通知を1通だけ送る。
// 使い方: VAPID_PRIVATE_KEY=... BLOB_READ_WRITE_TOKEN=... node collector/push-test.mjs "本文"
import { list, del } from '@vercel/blob';
import webpush from 'web-push';

const SITE = 'https://ositopia.com';
const VAPID_PUBLIC = 'BBrg_UQ1b9l-BGpztBQmAnhQroZDk8NaZHuG-es6Wx4m_HKfEJhBkURR8IZuIv-dGOQArskgBFJsL_bnpMs9rxU';
const body = process.argv[2] || '通知のテストです。これが見えていれば成功です 🎉';

const priv = process.env.VAPID_PRIVATE_KEY, token = process.env.BLOB_READ_WRITE_TOKEN;
if (!priv || !token) { console.error('鍵が設定されていません'); process.exit(1); }

const { blobs } = await list({ prefix: 'subs/', token });
console.log(`登録されている端末: ${blobs.length} 台`);
if (!blobs.length) { console.log('まだ登録がありません。スマホで「通知をオンにする」を押してから、もう一度実行してください'); process.exit(0); }

webpush.setVapidDetails('mailto:info@ositopia.com', VAPID_PUBLIC, priv);
for (const b of blobs) {
  const sub = await (await fetch(b.url, { cache: 'no-store' })).json();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify({ title: '推しトピア', body, url: SITE + '/#/home', tag: 'test' }));
    console.log('送信しました →', sub.endpoint.slice(0, 55) + '…（推し:', (sub.follow || []).join(',') || '未設定', '）');
  } catch (e) {
    console.error('失敗', e.statusCode || e.message);
    if (e.statusCode === 404 || e.statusCode === 410) { await del(b.url, { token }); console.log('→ 無効な登録だったので削除しました'); }
  }
}
