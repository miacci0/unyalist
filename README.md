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

Animator Workspace / routine-appと同じSupabaseプロジェクトのSQL Editorで、以下の順に実行する。

1. [`supabase/unyalist_schema.sql`](supabase/unyalist_schema.sql)
2. [`supabase/gmail_multi_account.sql`](supabase/gmail_multi_account.sql)
   (`gmail_accounts`テーブルを追加し、旧`inquiry_sync_state`テーブルを置き換える)
3. [`supabase/gmail_lookback_default.sql`](supabase/gmail_lookback_default.sql)
   (新規接続時の初期取得範囲を24時間→7日間に変更)
4. [`supabase/inquiry_threading.sql`](supabase/inquiry_threading.sql)
   (返信メールを元の依頼にまとめて取り込むためのカラム・RPCを追加)
5. [`supabase/inquiry_thread_merge.sql`](supabase/inquiry_thread_merge.sql)
   (既存の重複行を統合する「重複を統合」ボタン用のカラムを追加)

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

新規接続直後は過去7日分のメールが自動的に取得対象になる。それより前まで遡りたい場合や、
既に接続済みのアカウントをより過去まで遡って取り込み直したい場合は、各アカウント行の
日数欄(1〜90日、デフォルト7)を書き換えて「再取得」を押す。押すとその場ですぐに同期が実行され、
取得件数がトースト表示される(cronの次回実行=最大15分を待つ必要はない)。一度に処理しきれない
ほど件数が多い場合は自動的に複数回に分けて処理されるため、時間をおいてもう一度押せば続きが処理される。

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

## AI分類プロンプトの動作確認

`lib/gemini.js`のプロンプトやresponseSchemaを変更した際は、実メールの受信やcron実行を介さず
ローカルで即座に試せる。

```bash
npm run test:classify
```

件名→Enter、続けて本文を貼り付けて最後にCtrl+D(WindowsはCtrl+Z→Enter)を押すと、Gemini APIの
生レスポンスとJSONパース結果が表示される。`GEMINI_API_KEY`は`.env.local`から読む。

## 返信メールの扱い

依頼メールへの返信(相手からの返信・自分から送った返信のどちらも)は、GmailのthreadIdを
キーに元の依頼行へ紐付けられ、別の案件として新規保存されることはない(送信済みメールは
そもそもポーリング対象から除外している)。一覧上に返信の内容自体は表示しないため、
やり取りの詳細は件名リンクからGmailを開いて確認する。この判定は本機能を有効にした後に
受信したメールにのみ適用され、既に別行として保存済みの過去の返信は自動では統合されない。

過去にすでに別行として保存されてしまった返信メールは、一覧画面の「重複を統合」ボタンから
まとめられる。GmailのthreadIdを手がかりに、同じやり取りの行のうち最も古いものを残して
残りを一覧から隠す(削除はしない。統合前に手動でステータスを変更していた行があった場合、
そのステータスは一覧からは見えなくなるが行自体はDBに残る)。何度押しても安全(未処理分だけを
毎回処理する)ため、思い出したときにいつでも実行してよい。

## AI分類が失敗した場合の挙動

Gemini API呼び出しが失敗した場合(レート制限・一時的なサーバーエラー・応答の解析失敗など、
メール内容とは無関係な理由による失敗)、そのメッセージは`inquiries`へ**保存されない**
([lib/gmailSync.js](lib/gmailSync.js))。保存してしまうと重複防止の仕組み上二度と再取得されず、
「本物の依頼メールが理由不明のまま非依頼扱いされ続ける」事故になっていたため(2026年9月に
`responseSchema`の不整合・提供終了モデル・レート制限(429)の3件で実際に発生)。未保存のメッセージは
`gmail_accounts.last_checked_at`が先に進まないため、次回のcron実行または「再取得」ボタンで
自動的に再挑戦される。429(レート制限)は`lib/gemini.js`側で数回自動リトライもする。

## 既知の不具合と復旧手順(2026年9月): AI分類の全件失敗(過去分)

上記の仕組みが入る前は、分類に失敗したメッセージも`(AI分類に失敗しました)`という要約付きで
「非依頼」として保存してしまっていた。この期間に取り込まれてしまった行は自動では再取得されないため、
影響を受けた既存アプリでは一度だけSupabase SQL Editorで以下を実行して該当行を削除し、

```sql
delete from inquiries where summary like '%AI分類に失敗しました%';
```

各Gmailアカウントの「再取得」ボタン(必要な日数を指定)から取り込み直すこと。

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
