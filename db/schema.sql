-- 推しトピア データベース設計（Supabase / PostgreSQL）
-- Supabaseの「SQL Editor」にこのファイルの中身を貼り付けて実行してください。
-- 何度実行しても同じ結果になるように書いてあります。

-- ===== プロフィール =====
-- ログインした人の情報。会員番号は登録順の通し番号。
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  member_no   bigserial unique,                -- 会員番号（#000001から順番）
  handle      text not null,                   -- ハンドルネーム（2〜12文字）
  age_band    text,                            -- 10代 / 20代 …（市区町村や生年月日は保存しない）
  pref        text,                            -- 都道府県まで
  oshi        text,                            -- いちばんの推しグループ
  bio         text default '',
  links       jsonb default '{}'::jsonb,       -- SNSのリンク
  follow      text[] default '{}',             -- 推しグループ
  banned      boolean default false,           -- 凍結
  banned_note text,
  created_at  timestamptz default now()
);
create index if not exists profiles_handle_idx on profiles (handle);

-- ===== 掲示板 =====
create table if not exists threads (
  id          bigserial primary key,
  group_id    text,                            -- milk / chotokkyu … null は全体
  cat         text not null default '雑談',    -- 実況 / ライブ / 新曲 …
  title       text not null,
  live        boolean default false,           -- 出演情報から自動で立った実況スレ
  src_url     text,                            -- 元になった公式情報
  when_label  text,
  author_name text not null default '名無しさん',
  user_id     uuid references profiles(id) on delete set null,
  hidden      boolean default false,           -- 運営が非表示にした
  reply_count integer default 1,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists threads_updated_idx on threads (updated_at desc);
create index if not exists threads_group_idx on threads (group_id);
create unique index if not exists threads_live_key on threads (title) where live;

create table if not exists posts (
  id          bigserial primary key,
  thread_id   bigint not null references threads(id) on delete cascade,
  no          integer not null,                -- スレ内の番号（1, 2, 3 …）
  body        text not null,
  author_name text not null default '名無しさん',
  anon_id     text,                            -- 名無しの日替わりID（画面に出る）
  user_id     uuid references profiles(id) on delete set null,
  hidden      boolean default false,
  created_at  timestamptz default now(),
  unique (thread_id, no)
);
create index if not exists posts_thread_idx on posts (thread_id, no);

-- 発信者情報（IPなど）は別表にして、運営だけが見られるようにする
create table if not exists post_meta (
  post_id    bigint primary key references posts(id) on delete cascade,
  ip         text,
  user_agent text,
  created_at timestamptz default now()
);

-- ===== リアクション =====
create table if not exists reactions (
  post_id   bigint not null references posts(id) on delete cascade,
  kind      text not null check (kind in ('wakaru','suki','warota')),
  client_id text not null,                     -- ログインしていない人も押せるよう端末ごとのID
  created_at timestamptz default now(),
  primary key (post_id, kind, client_id)
);

-- ===== 通報 =====
create table if not exists reports (
  id          bigserial primary key,
  target_type text not null,                   -- post / thread / comment
  target_id   text not null,
  reason      text not null,
  note        text,
  reporter    text,                            -- 会員番号 または 端末ID
  done        boolean default false,
  created_at  timestamptz default now()
);
create index if not exists reports_done_idx on reports (done, created_at desc);

-- ===== コミュニティ =====
create table if not exists communities (
  id         bigserial primary key,
  group_id   text,
  name       text not null,
  kind       text not null default 'その他',
  description text default '',
  rules      text[] default '{}',
  join_type  text not null default '承認制',   -- 承認制 / だれでも
  only_band  text,                             -- 10代 / 18歳以上
  admin_id   uuid references profiles(id) on delete set null,
  member_count int default 0,                 -- 参加者の数（承認済みのみ）
  created_at timestamptz default now()
);
create table if not exists community_members (
  community_id bigint references communities(id) on delete cascade,
  user_id      uuid references profiles(id) on delete cascade,
  status       text not null default 'pending', -- pending / approved
  created_at   timestamptz default now(),
  primary key (community_id, user_id)
);
create table if not exists events (
  id           bigserial primary key,
  community_id bigint references communities(id) on delete cascade,
  title        text not null,
  date         date not null,
  time         text,
  place        text,                            -- 参加者にだけ見せる
  area         text,                            -- 誰にでも見せる
  cap          integer default 10,
  target_band  text not null default '18歳以上',-- 10代限定 / 18歳以上
  description  text default '',
  host_id      uuid references profiles(id) on delete set null,
  joined_count integer default 0,
  created_at   timestamptz default now()
);
create index if not exists ev_comm_idx on events (community_id, date);
create table if not exists event_members (
  event_id   bigint references events(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (event_id, user_id)
);

-- ===== お知らせ（運営 → ユーザー） =====
create table if not exists notices (
  id         bigserial primary key,
  user_id    uuid references profiles(id) on delete cascade,  -- null なら全員あて
  title      text not null,
  body       text not null,
  created_at timestamptz default now()
);
create table if not exists notice_reads (
  notice_id bigint references notices(id) on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  read_at   timestamptz default now(),
  primary key (notice_id, user_id)
);

-- ===== 公開範囲の設定（Row Level Security） =====
-- 読むのは誰でもOK。書き込みはサーバー（Vercelの関数）経由だけに限定する。
alter table profiles          enable row level security;
alter table threads           enable row level security;
alter table posts             enable row level security;
alter table reactions         enable row level security;
alter table reports           enable row level security;
alter table communities       enable row level security;
alter table community_members enable row level security;
alter table events            enable row level security;
alter table event_members     enable row level security;
alter table notices           enable row level security;
alter table notice_reads      enable row level security;
alter table post_meta         enable row level security;   -- 誰にも読ませない（運営のみ）

drop policy if exists "読むのは誰でも" on threads;
create policy "読むのは誰でも" on threads for select using (not hidden);
drop policy if exists "読むのは誰でも" on posts;
create policy "読むのは誰でも" on posts for select using (true);
drop policy if exists "読むのは誰でも" on reactions;
create policy "読むのは誰でも" on reactions for select using (true);
drop policy if exists "読むのは誰でも" on communities;
create policy "読むのは誰でも" on communities for select using (true);
drop policy if exists "読むのは誰でも" on events;
create policy "読むのは誰でも" on events for select using (true);
-- 参加状況（誰がどのコミュニティ・イベントにいるか）も読めるようにする
drop policy if exists "参加状況は誰でも読める" on community_members;
create policy "参加状況は誰でも読める" on community_members for select using (true);
drop policy if exists "イベント参加者は誰でも読める" on event_members;
create policy "イベント参加者は誰でも読める" on event_members for select using (true);
create index if not exists cm_user_idx on community_members (user_id);

-- プロフィールは公開情報のみ（本人は自分の全部を見られる）
drop policy if exists "公開プロフィール" on profiles;
create policy "公開プロフィール" on profiles for select using (true);
drop policy if exists "自分のプロフィールを更新" on profiles;
create policy "自分のプロフィールを更新" on profiles for update using (auth.uid() = id);

-- お知らせは本人あて or 全員あてのみ
drop policy if exists "自分あてのお知らせ" on notices;
create policy "自分あてのお知らせ" on notices for select using (user_id is null or user_id = auth.uid());
