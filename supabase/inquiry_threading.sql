-- UnyaList: 依頼メールへの返信を新規案件化させず、元の依頼にまとめるためのマイグレーション。
-- gmail_multi_account.sql適用済みのSupabaseプロジェクトに対して実行する。

alter table inquiries add column if not exists thread_id text;
-- このスレッドで後から取り込んだ返信のメッセージID一覧。重複防止(既に処理済みかどうかの判定)に使う。
alter table inquiries add column if not exists merged_message_ids text[] not null default '{}';

-- 「このthreadIdは既知の案件の続きか」を調べる検索用。
create index if not exists inquiries_thread_lookup_idx on inquiries (user_id, gmail_account_id, thread_id);

-- 返信メッセージのIDをmerged_message_idsへ安全に追記するRPC。routine_appの
-- set_routine_log_entry(jsonbマージ)と同じ方針で、read-modify-writeではなく1回のUPDATEで
-- 完結させることで、同時実行時の上書きロスを避ける。
create or replace function append_thread_message(p_inquiry_id uuid, p_message_id text)
returns void
language sql
security invoker
as $$
  update inquiries
  set merged_message_ids = array_append(merged_message_ids, p_message_id),
      updated_at = now()
  where id = p_inquiry_id;
$$;
