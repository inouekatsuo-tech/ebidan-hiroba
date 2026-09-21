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
git diff --cached --quiet || git commit -qm "${1:-サイトを更新}"
git push -q
echo "push しました。1分ほどで https://milkies-hiroba.vercel.app に反映されます"
