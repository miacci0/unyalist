// 仕事用の別Googleアカウントに対して、Gmail読み取り専用スコープのOAuth同意を一度だけ通し、
// refresh tokenを取得するためのローカル実行専用スクリプト。
//
// 事前準備: Google Cloud ConsoleでGmail APIを有効化し、OAuthクライアントID(ウェブアプリケーション)を
// 発行して GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を .env.local に設定しておくこと。
// また、そのOAuthクライアントの「承認済みのリダイレクトURI」に
// http://localhost:53682/oauth2callback を追加しておくこと。
//
// 使い方: npm run gmail:token
// → 表示されたURLを「仕事用のGoogleアカウント」でブラウザから開いて同意する
// → 取得したrefresh tokenを .env.local (と本番はVercelの環境変数) の
//   GOOGLE_REFRESH_TOKEN に設定する

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { google } from "googleapis";

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function loadEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env.local に設定されていません。先に設定してください。");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // 毎回refresh tokenを確実に発行させるため
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  console.log("\n以下のURLを「仕事用のGoogleアカウント」でブラウザから開いて同意してください:\n");
  console.log(authUrl);
  console.log(`\n(ローカルの ${REDIRECT_URI} で認可コードの受信を待機しています…)\n`);

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const receivedCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(error ? "<p>認可に失敗しました。ターミナルを確認してください。このタブは閉じて構いません。</p>" : "<p>認可が完了しました。このタブは閉じて構いません。</p>");
      server.close();
      if (error) reject(new Error(error));
      else resolve(receivedCode);
    });
    server.listen(REDIRECT_PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nrefresh_tokenが取得できませんでした。既にこのアプリを一度承認済みの場合、Googleアカウントの" +
        "「サードパーティ製アプリとサービスへのアクセス」からUnyaListへのアクセスを一度取り消してから再実行してください。"
    );
    process.exit(1);
  }

  console.log("\n取得できました。以下の値を .env.local と本番(Vercel)の環境変数に設定してください:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch(err => {
  console.error("失敗しました:", err);
  process.exit(1);
});
