#!/bin/zsh
# mock/index.html（原本）から Vercel 用ページを作り直してデプロイする
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
s=open('milkies-hiroba/index.html').read()
head=s[:s.index('<title>')]
open('milkies-hiroba/index.html','w').write(head+open('mock/index.html').read()+'\n</html>\n')
PY
cd milkies-hiroba && vercel deploy --prod --yes
