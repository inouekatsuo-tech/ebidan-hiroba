// Xに「投稿する権限」を一度だけもらうための道具。
// 実行するとブラウザが開くので、@milkies_papa でログインして「アプリにアクセスを許可」を押すだけ。
// もらった合言葉（refresh token）はデータベースの tokens 表に保存する（画面には表示しない）。
//
// 事前に X の開発者ポータルで2つ設定しておくこと:
//   1. User authentication settings → App permissions を「Read and write」に
//   2. Callback URI に http://127.0.0.1:8787/callback を追加
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const { X_CLIENT_ID: ID, X_CLIENT_SECRET: SECRET, SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY } = process.env;
if (!ID || !SECRET || !SB || !KEY) { console.error('環境変数が足りません'); process.exit(1); }

const PORT = 8787, CB = `http://127.0.0.1:${PORT}/callback`;
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(12).toString('hex');

const url = new URL('https://x.com/i/oauth2/authorize');
url.searchParams.set('response_type', 'code');
url.searchParams.set('client_id', ID);
url.searchParams.set('redirect_uri', CB);
url.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
url.searchParams.set('state', state);
url.searchParams.set('code_challenge', challenge);
url.searchParams.set('code_challenge_method', 'S256');

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const send = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>${msg}</h2><p>この画面は閉じて大丈夫です。</p>`); };
  try {
    if (u.searchParams.get('state') !== state) throw new Error('state が合いません');
    const code = u.searchParams.get('code');
    if (!code) throw new Error('許可されませんでした');

    const r = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CB, code_verifier: verifier, client_id: ID }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) throw new Error('合言葉をもらえませんでした ' + JSON.stringify(j).slice(0, 200));

    // 誰のアカウントとしてつながったか確認する
    const me = await (await fetch('https://api.x.com/2/users/me', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();

    const sv = await fetch(`${SB}/rest/v1/tokens`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'x_auth', value: { refresh: j.refresh_token, user: me.data?.username || '' }, updated_at: new Date().toISOString() }),
    });
    if (!sv.ok) throw new Error('保存に失敗 ' + sv.status + ' ' + (await sv.text()).slice(0, 150));

    send('設定できました 🎉');
    console.log(`\n✅ @${me.data?.username} として投稿できるようになりました。合言葉はデータベースに保存しました。`);
  } catch (e) {
    send('うまくいきませんでした');
    console.error('\n❌ ' + e.message);
  } finally {
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('ブラウザで「許可」を押してください。開かない場合は次のURLを開いてください:\n' + url.toString() + '\n');
  spawn('open', [url.toString()], { stdio: 'ignore', detached: true }).unref();
});
