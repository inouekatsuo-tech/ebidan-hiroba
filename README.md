# 推しトピア（試作モック）

スターダスト男性アイドル（EBiDAN系10グループ）の非公式ファン広場のモック。グループ×カテゴリ（メディア/イベント/グッズ/リリース/お知らせ）で情報を仕分け。持ち寄り投稿／掲示板／コミュニティ（mixi型・イベント）。
データはすべて架空のサンプルで、書き込みは各ブラウザの中だけに保存される。

- 公開URL: https://ositopia.com （検索エンジン除外設定済み。旧 https://milkies-hiroba.vercel.app も有効）
- Claude上のモック: https://claude.ai/artifact/Rkbtt3YmKJauFBA2TStMzB

## ファイル
- `mock/index.html` … **サイトの原本。修正はここだけ**
- `milkies-hiroba/` … Vercel公開用（原本にHTMLヘッダー・noindexを足したもの。直接編集しない）
  - `data/items.json` … 自動収集した公式情報（GitHub Actionsが更新）
- `collector/collect.mjs` … EBiDAN公式サイト（ニュース・動画・スケジュール）から集めて仕分けるプログラム
- `.github/workflows/collect.yml` … 30分ごとに collect.mjs を実行
- `deploy.sh` … 公開用ページを作り直して GitHub に push（Vercelが自動デプロイ）

## 更新手順
1. `mock/index.html` を編集
2. `./deploy.sh "変更内容のメモ"`

## 自動収集のしくみ
GitHub Actions が30分ごとに `node collector/collect.mjs` を実行 → 変化があれば `data/items.json` をコミット → Vercel が自動で再デプロイ。
取得するのはタイトル・日付・リンク・公式カテゴリのみ（本文・画像はコピーしない）。
どれかの情報源が0件になったら失敗扱い → GitHubから失敗通知メールが届く（公式サイトの構成変更のサイン）。
手元で試す: `node collector/collect.mjs`

## 次にやること
- 娘さん・友達からのフィードバック反映
- 本番化するなら: Next.js + Supabase（DB・リアルタイム）+ Clerk（Google/Apple/X/LINE/メールのログイン）
