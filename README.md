# UnyaList

仕事依頼のメール(Gmail)を自動で検知・分類し、「未確定案件」として一覧管理するツール。
要約・情報抽出・一次仕分けはAI(Gemini)が行い、ユーザーは「受けるか断るか」の判断と
ステータス操作(一覧上のワンクリック)だけに集中できるようにする。

Animator Workspace / routine-appとは別リポジトリの独立Next.jsアプリとして開発し(同じ方針は
`draw/`にも採用)、Supabaseプロジェクトのみ共有する。詳細設計は
[`inquiry-mvp-claude-code-instructions.md`](../ ) を参照。

## 技術スタック

- Next.js (App Router, JS) / React
- Supabase(Animator Workspace / routine-appと同一プロジェクトを共有。`inquiries` /
  `gmail_accounts` テーブルのみ新規追加)
- Gmail API (`gmail.readonly`、複数の仕事用Googleアカウントをアプリ内のOAuth連携ボタンから追加可能)
- Gemini API(Flash系モデル)
- Vercel(Hobbyプラン)+ GitHub Actions(定期ポーリング用。Vercel Hobbyはcronが1日1回までのため)

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Supabaseスキーマの適用

Animator Workspace / routine-appと同じSupabaseプロジェクトのSQL Editorで
[`supabase/unyalist_schema.sql`](supabase/unyalist_schema.sql) を実行し、続けて複数Gmailアカウント
対応のマイグレーション [`supabase/gmail_multi_account.sql`](supabase/gmail_multi_account.sql) も実行する
(`gmail_accounts`テーブルを追加し、旧`inquiry_sync_state`テーブルを置き換える)。

### 3. Supabase側のリダイレクトURL登録

Supabaseダッシュボード → Authentication → URL Configuration → Redirect URLs に、
このアプリのURL(開発時 `http://localhost:3004`、本番デプロイURL)を追加する
(routine-appと同じ既知の注意点)。

### 4. Google Cloud ConsoleでGmail OAuthクライアントを作成

1. 新規(または既存の)Google Cloudプロジェクトで **Gmail API** を有効化する
2. OAuth同意画面を設定する(External)。**「テスト」ステータスのままの場合、追加したい
   仕事用Googleアカウントをすべてテストユーザーとして登録する**(登録していないアカウントは
   同意画面でエラーになる)。またテストステータスのrefresh tokenは**7日で失効する**制約があるため、
   頻繁に接続が切れて困るようであれば本番公開への切り替えも検討する
3. OAuthクライアントID(ウェブアプリケーション)を発行し、承認済みのリダイレクトURIに
   `http://localhost:3004/api/gmail/oauth/callback` と本番デプロイURLの同パスを追加する
4. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を控える(すべてのGmailアカウントで共通のOAuth
   クライアントを使い回す)

### 5. 環境変数の設定

`.env.local.example` を `.env.local` にコピーし、値を埋める。`GMAIL_TOKEN_ENCRYPTION_KEY`は
`openssl rand -base64 32` で生成する。`UNYALIST_OWNER_EMAIL` は **UnyaListにログインする個人
Googleアカウント**(Animator Workspace / routine-appと同じアカウントを想定)のメールアドレス。
Gmail取得対象の**仕事用アカウントとは別物**。

```bash
cp .env.local.example .env.local
openssl rand -base64 32   # GMAIL_TOKEN_ENCRYPTION_KEYの値に使う
```

### 6. 開発サーバー起動 & Gmailアカウントの接続

```bash
npm run dev -- -p 3004
```

`http://localhost:3004` を開き、個人Googleアカウントでログインする。画面上部の
「+ Gmailアカウントを追加」ボタンから、案件管理の対象にしたい仕事用Googleアカウントで
Google側の同意画面に進み、許可する。**複数ある場合はこのボタンをアカウントの数だけ繰り返す**
(同じ画面に接続済みアカウントが一覧表示され、表示名の変更・一時停止・解除ができる)。

### 7. cronパイプラインの手動テスト

```bash
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3004/api/cron/fetch-inquiries
```

接続した仕事用Gmailアカウントにテストメール(仕事依頼っぽい文面・広告っぽい文面の両方)を
送っておくと、分類精度を確認しやすい。レスポンスJSONの`accounts`配列に接続アカウントごとの
処理結果が入る。

### 8. 本番デプロイ(Vercel)

1. Vercelに新規プロジェクトとしてデプロイし、`.env.local`と同じ環境変数を設定する
2. このリポジトリの GitHub Settings → Secrets and variables → Actions に、
   `CRON_SECRET`(同じ値)と `UNYALIST_APP_URL`(本番デプロイURL、末尾スラッシュなし)を登録する
3. `.github/workflows/poll-inquiries.yml` が15分間隔で `/api/cron/fetch-inquiries` を呼び出す
   (GitHub Actionsのscheduled workflowは実行間隔が保証ではなく目安で、60日間リポジトリに
   コミットが無いと自動停止する点に注意。将来Vercel Proに上げた場合は`vercel.json`のcronに
   切り替えられる)

## 既存の単一アカウント運用からの移行

これまで`GOOGLE_REFRESH_TOKEN`環境変数で単一アカウントを接続していた場合、上記手順2の
マイグレーション適用後、手順6の「Gmailアカウントを追加」から同じ仕事用Googleアカウントを
一度だけ再接続すればよい(データの手動移行は不要)。再接続できたら`GOOGLE_REFRESH_TOKEN`は
Vercelの環境変数から削除して構わない。

## 既知の制限(MVP)

- 表示言語は日本語のみ
- ドラッグ並べ替え・複数選択削除は未実装
- 希望納期の自由記述→日付変換は次段階
- X DM・LINE対応はスコープ外(`source_channel`カラムで将来拡張できるようにはしてある)
