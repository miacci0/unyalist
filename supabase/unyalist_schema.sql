-- UnyaList (仕事依頼管理システム) 用スキーマ。
-- Animator Workspace / routine-appと同じSupabaseプロジェクトのSQL Editorで実行する。
-- 既存テーブル(app_data, routine_* など)には一切触れない、完全新規のテーブルのみ。

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null,
  sender_name text,
  sender_email text,
  subject text,
  summary text,
  project_name text,
  expected_deadline text,
  expected_rate text,
  confidence_score float not null default 0,
  status text not null default '未確認'
    check (status in ('未確認', '検討中', '返信済み', '保留', '成立', '不成立', '非依頼')),
  -- 将来X DM・LINEなど他媒体に対応する際の拡張余地(指示書セクション10)。現状はemail固定。
  source_channel text not null default 'email',
  source_message_id text not null,
  raw_body_snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_message_id)
);

alter table inquiries enable row level security;

create policy "inquiries_select_own" on inquiries
  for select using (auth.uid() = user_id);

create policy "inquiries_update_own" on inquiries
  for update using (auth.uid() = user_id);

-- insertはservice role(cron)のみが行うため、クライアント向けのinsertポリシーは用意しない。

create index if not exists inquiries_user_status_idx on inquiries (user_id, status);
create index if not exists inquiries_user_received_at_idx on inquiries (user_id, received_at desc);

-- Gmail検索の "after:<unix秒>" カーソルを1ユーザー1行で保持する同期状態テーブル。
create table if not exists inquiry_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_checked_at timestamptz not null default now()
);

alter table inquiry_sync_state enable row level security;

create policy "inquiry_sync_state_select_own" on inquiry_sync_state
  for select using (auth.uid() = user_id);

-- 読み書きともcron(service role)が行うため、update/insertのクライアント向けポリシーは無し。
