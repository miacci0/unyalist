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
  `inquiry_sync_state` テーブルのみ新規追加)
- Gmail API (`gmail.readonly`、仕事用の別Googleアカウント)
- Gemini API(Flash系モデル)
- Vercel(Hobbyプラン)+ GitHub Actions(定期ポーリング用。Vercel Hobbyはcronが1日1回までのため)

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Supabaseスキーマの適用

Animator Workspace / routine-appと同じSupabaseプロジェクトのSQL Editorで
[`supabase/unyalist_schema.sql`](supabase/unyalist_schema.sql) を実行する。

### 3. Supabase側のリダイレクトURL登録

Supabaseダッシュボード → Authentication → URL Configuration → Redirect URLs に、
このアプリのURL(開発時 `http://localhost:3004`、本番デプロイURL)を追加する
(routine-appと同じ既知の注意点)。

### 4. Google Cloud ConsoleでGmail OAuthクライアントを作成

1. 新規(または既存の)Google Cloudプロジェクトで **Gmail API** を有効化する
2. OAuth同意画面を設定する(External、テストユーザーに仕事用Googleアカウントを追加)
3. OAuthクライアントID(ウェブアプリケーション)を発行し、承認済みのリダイレクトURIに
   `http://localhost:53682/oauth2callback` を追加する
4. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を控える

### 5. 環境変数の設定

`.env.local.example` を `.env.local` にコピーし、値を埋める。
`UNYALIST_OWNER_EMAIL` は **UnyaListにログインする個人Googleアカウント**(Animator Workspace /
routine-appと同じアカウントを想定)のメールアドレス。Gmail取得対象の**仕事用アカウントとは別物**。

```bash
cp .env.local.example .env.local
```

### 6. Gmailのrefresh tokenを取得

```bash
npm run gmail:token
```

表示されたURLを**仕事用のGoogleアカウント**でブラウザから開いて同意し、取得した
`GOOGLE_REFRESH_TOKEN` を `.env.local` に追記する。

### 7. 開発サーバー起動

```bash
npm run dev -- -p 3004
```

`http://localhost:3004` を開き、個人Googleアカウントでログインする(一覧はまだ空)。

### 8. cronパイプラインの手動テスト

```bash
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3004/api/cron/fetch-inquiries
```

仕事用Gmailアカウントにテストメール(仕事依頼っぽい文面・広告っぽい文面の両方)を送っておくと、
分類精度を確認しやすい。

### 9. 本番デプロイ(Vercel)

1. Vercelに新規プロジェクトとしてデプロイし、`.env.local`と同じ環境変数を設定する
2. このリポジトリの GitHub Settings → Secrets and variables → Actions に、
   `CRON_SECRET`(同じ値)と `UNYALIST_APP_URL`(本番デプロイURL、末尾スラッシュなし)を登録する
3. `.github/workflows/poll-inquiries.yml` が15分間隔で `/api/cron/fetch-inquiries` を呼び出す
   (GitHub Actionsのscheduled workflowは実行間隔が保証ではなく目安で、60日間リポジトリに
   コミットが無いと自動停止する点に注意。将来Vercel Proに上げた場合は`vercel.json`のcronに
   切り替えられる)

## 既知の制限(MVP)

- 表示言語は日本語のみ
- ドラッグ並べ替え・複数選択削除は未実装
- 希望納期の自由記述→日付変換は次段階
- X DM・LINE対応はスコープ外(`source_channel`カラムで将来拡張できるようにはしてある)
