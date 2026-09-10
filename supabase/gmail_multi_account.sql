-- UnyaList: 複数Gmailアカウント対応マイグレーション。
-- unyalist_schema.sql適用済みのSupabaseプロジェクトに対して実行する。

create table if not exists gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  gmail_email text not null,
  refresh_token_encrypted text not null,
  enabled boolean not null default true,
  -- アカウントごとのGmail検索カーソル("after:<unix秒>"の起点)。単一行前提だった
  -- inquiry_sync_stateをこのカラムで置き換える。
  last_checked_at timestamptz not null default (now() - interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gmail_email)
);

-- refresh tokenという秘密情報を含むため、user_dropbox_connectionsと同じ方針で
-- RLSは有効化するがポリシーは一切追加しない(service-role経由のAPIルートでのみ読み書きする)。
alter table gmail_accounts enable row level security;

-- inquiriesにどのアカウントで受信したかを記録する。
-- gmail_account_idはアカウント削除で参照だけがnullになり(on delete set null)、
-- mailbox_emailは非正規化スナップショットとして残るため、アカウントを解除しても
-- 過去のinquiriesの「どのアドレス宛だったか」の表示は失われない。
alter table inquiries add column if not exists gmail_account_id uuid references gmail_accounts(id) on delete set null;
alter table inquiries add column if not exists mailbox_email text;

-- inquiriesの重複防止制約(unique(user_id, source_message_id))はアカウントをまたいでも
-- 意図的に変更しない。複合キー化するとアカウント再接続時に同じメッセージが再度取り込まれ
-- 重複行になるリスクの方が大きいため(詳細は実装計画を参照)。

-- 単一アカウント運用時代のカーソルテーブルはgmail_accounts.last_checked_atに完全に
-- 置き換えられたため削除する。
drop table if exists inquiry_sync_state;
