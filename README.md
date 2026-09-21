# えびだん広場（試作モック）

スターダスト男性アイドル（EBiDAN系10グループ）の非公式ファン広場のモック。グループ×カテゴリ（メディア/イベント/グッズ/リリース/お知らせ）で情報を仕分け。持ち寄り投稿／掲示板／コミュニティ（mixi型・イベント）。
データはすべて架空のサンプルで、書き込みは各ブラウザの中だけに保存される。

- 公開URL: https://milkies-hiroba.vercel.app （検索エンジン除外設定済み）
- Claude上のモック: https://claude.ai/artifact/Rkbtt3YmKJauFBA2TStMzB

## ファイル
- `mock/index.html` … **原本。修正はここだけ**
- `milkies-hiroba/` … Vercel公開用（原本にHTMLヘッダー・noindexを足したもの。直接編集しない）
- `deploy.sh` … 公開用ページを作り直してVercelへデプロイ

## 更新手順
1. `mock/index.html` を編集
2. `./deploy.sh`

## 次にやること
- 娘さん・友達からのフィードバック反映
- 本番化するなら: Next.js + Supabase（DB・リアルタイム）+ Clerk（Google/Apple/X/LINE/メールのログイン）
