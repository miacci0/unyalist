-- UnyaList: 新規接続時のGmail初期取得範囲を24時間→7日間に広げるマイグレーション。
-- gmail_multi_account.sql適用済みのSupabaseプロジェクトに対して実行する。
--
-- 既存の接続済みアカウントのlast_checked_atは変更しない(このカラムはデフォルト値なので
-- 新規INSERT時にのみ効く)。既に接続済みのアカウントをより過去まで遡らせたい場合は、
-- UnyaListの画面上の各アカウントの「◯日前まで / 再取得」から行う。
alter table gmail_accounts alter column last_checked_at set default (now() - interval '7 days');
