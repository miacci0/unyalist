-- UnyaList: 「返信済み」「保留」「成立」の案件に新着返信が来たら「返信待ち」へ自動遷移させる
-- マイグレーション。inquiry_threading.sql適用済みのSupabaseプロジェクトに対して実行する。

-- unyalist_schema.sqlでは無名のcheck制約として定義したため、Postgresの既定命名規則により
-- inquiries_status_checkという名前が付いている。'返信待ち'を含む一覧に差し替える。
alter table inquiries drop constraint if exists inquiries_status_check;
alter table inquiries add constraint inquiries_status_check
  check (status in ('未確認', '検討中', '返信待ち', '返信済み', '保留', '成立', '不成立', '非依頼'));

-- append_thread_messageに、新着返信を検知した際だけステータスを「返信待ち」へ戻す
-- p_reopenオプションを追加する(既定はfalseなので、既存の呼び出し元は挙動が変わらない)。
-- lib/gmailSync.js(今まさに届いた新着返信)はp_reopen: trueで呼ぶ。
-- lib/threadConsolidation.js(過去の別行を後から統合するだけ)はp_reopenを渡さず、
-- 統合してもステータスは動かさない。
create or replace function append_thread_message(p_inquiry_id uuid, p_message_id text, p_reopen boolean default false)
returns void
language sql
security invoker
as $$
  update inquiries
  set merged_message_ids = array_append(merged_message_ids, p_message_id),
      updated_at = now(),
      status = case when p_reopen and status in ('返信済み', '保留', '成立') then '返信待ち' else status end
  where id = p_inquiry_id;
$$;
