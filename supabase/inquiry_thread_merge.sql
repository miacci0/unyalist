-- UnyaList: すでに別行として保存されてしまっている返信メールを、後から元の依頼行に
-- 統合できるようにするマイグレーション。inquiry_threading.sql適用済みのSupabaseプロジェクトに
-- 対して実行する。

-- 統合された(=重複と判定された)行はここに代表行のidが入る。削除はせず一覧から隠すだけにする
-- ことで、誤統合があっても行自体は残り復元しやすいようにしてある。
alter table inquiries add column if not exists merged_into_id uuid references inquiries(id) on delete set null;

create index if not exists inquiries_merged_into_idx on inquiries (merged_into_id);
