import { google } from "googleapis";

// Gmail読み取り専用アクセス(gmail.readonly)。複数の仕事用Googleアカウントを扱えるよう、
// このモジュールは呼び出し側が復号済みのrefresh tokenを渡してクライアントを作る形にしてある
// (1アカウント固定でモジュール内部にクライアントを持つ実装はやめた)。
// 実際のrefresh token(暗号化済み)はgmail_accountsテーブルに保存され、
// lib/gmailAccountAuth.jsのdecryptRefreshTokenで復号してからここに渡す。

// GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRETは全アカウント共通の同一OAuthクライアントを使い回す
// (Googleは同じOAuthクライアントに複数のGoogleアカウントが個別に同意できる)。
export function createGmailClient(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / refreshToken が揃っていません");
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// 接続したGoogleアカウント自身のメールアドレスを取得する(OAuth接続時のラベル表示用)。
export async function getProfileEmail(gmail) {
  const { data } = await gmail.users.getProfile({ userId: "me" });
  return data.emailAddress || null;
}

// afterUnixSeconds以降に受信したメールのメッセージIDを新しい順に取得する。
// チャット・迷惑メール・ゴミ箱は仕事依頼の判定対象から除外する。
export async function listRecentMessageIds(gmail, afterUnixSeconds, { maxResults = 50 } = {}) {
  const q = `after:${Math.floor(afterUnixSeconds)} -in:chats -in:spam -in:trash`;
  const messageIds = [];
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(100, maxResults - messageIds.length),
      pageToken,
    });
    for (const m of data.messages || []) messageIds.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && messageIds.length < maxResults);
  return messageIds;
}

function decodeBase64Url(data) {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// text/plainパートを優先し、無ければtext/htmlを簡易タグ除去してプレーンテキスト化する。
// 追加npm依存を増やさないための軽量実装(完璧な変換は狙わない)。
function extractBody(payload) {
  if (!payload) return "";

  let plainText = null;
  let htmlText = null;

  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || "";
    if (mimeType === "text/plain" && part.body?.data && plainText === null) {
      plainText = decodeBase64Url(part.body.data);
    } else if (mimeType === "text/html" && part.body?.data && htmlText === null) {
      htmlText = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);

  if (plainText !== null) return plainText;
  if (htmlText !== null) return stripHtml(htmlText);
  return "";
}

function headerValue(headers, name) {
  const header = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

// "山田太郎 <taro@example.com>" 形式のFromヘッダーを{name, email}に分解する。
function parseFrom(fromHeader) {
  const match = fromHeader.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    return { name: name || match[2].trim(), email: match[2].trim() };
  }
  return { name: fromHeader.trim(), email: fromHeader.trim() };
}

// 指定したメッセージIDの件名・送信者・本文プレーンテキスト・受信日時を取得する。
export async function getMessageDetail(gmail, messageId) {
  const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const headers = data.payload?.headers || [];
  const { name: senderName, email: senderEmail } = parseFrom(headerValue(headers, "From"));
  const subject = headerValue(headers, "Subject");
  const bodyText = extractBody(data.payload);
  const receivedAt = data.internalDate ? new Date(Number(data.internalDate)).toISOString() : new Date().toISOString();

  return {
    messageId,
    senderName,
    senderEmail,
    subject,
    bodyText,
    receivedAt,
  };
}
