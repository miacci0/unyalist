-- UnyaList: Gmailアカウントごとの直近の同期エラーを保存し、画面に警告として出せるようにする
-- マイグレーション。gmail_multi_account.sql適用済みのSupabaseプロジェクトに対して実行する。
--
-- OAuth同意画面が「テスト」ステータスだとrefresh tokenが7日で失効し(invalid_grant)、以後の
-- 同期が全て失敗する。以前はこの失敗がJSONの中に埋もれてどこにも表示されなかったため、
-- アカウント単位で最後のエラーを残す(Animator Workspaceのproject_dropbox_reports.last_error
-- と同じパターン)。gmail_accountsはservice-role専用テーブルなのでRLSの変更は不要。
alter table gmail_accounts add column if not exists last_error text;
alter table gmail_accounts add column if not exists last_error_at timestamptz;
