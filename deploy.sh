#!/bin/zsh
# mock/index.html（原本）から公開用ページを作り直して GitHub に push する。
# push すると Vercel が自動でサイトを更新する。
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
s=open('milkies-hiroba/index.html').read()
head=s[:s.index('<title>')]
open('milkies-hiroba/index.html','w').write(head+open('mock/index.html').read()+'\n</html>\n')
PY
git pull --rebase --autostash -q
git add -A
# gitの衝突あとが混ざったまま公開してしまわないように止める（items.jsonが壊れると情報が全部出なくなる）
if git diff --cached -U0 | grep -q '^+<<<<<<< \|^+>>>>>>> '; then
  echo "⚠️ 衝突マーカーが残っています。直してから deploy.sh を実行してください。" >&2
  git diff --cached --name-only | sed 's/^/  - /' >&2
  exit 1
fi
# データファイルがJSONとして壊れていないか確認する
for f in milkies-hiroba/data/items.json collector/times.json; do
  [ -f "$f" ] && ! python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f" 2>/dev/null && \
    { echo "⚠️ $f が壊れています。公開を中止しました。" >&2; exit 1; }
done
git diff --cached --quiet || git commit -qm "${1:-サイトを更新}"
git push -q
echo "push しました。1分ほどで https://milkies-hiroba.vercel.app に反映されます"
