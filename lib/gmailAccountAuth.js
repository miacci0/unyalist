import crypto from "crypto";

// Gmailアカウント接続(OAuth)まわりの暗号化・署名ユーティリティ。
// animator-workspace-app/lib/dropboxApiAuth.jsと同じ構成(AES-256-GCMでrefresh tokenを
// 暗号化して保存し、OAuthのstateはサーバー側にセッションを持たずHMAC自己署名でCSRF対策する)。
//
// サーバー専用モジュール。Node.jsのcryptoを使うため、ブラウザ側コードから読み込んではいけない。

const ENCRYPTION_ALGO = "aes-256-gcm";

function getEncryptionKey() {
  const base64Key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!base64Key) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY が設定されていません(.env.localを確認してください)");
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY の形式が不正です(32バイトをbase64化した値である必要があります)");
  }
  return key;
}

// refresh tokenをAES-256-GCMで暗号化する。gmail.readonlyスコープとはいえメール本文を
// 読める強い権限のため、Supabase側のデータだけが漏れた場合の多層防御として平文保存しない。
// 戻り値は "iv.authTag.ciphertext"(いずれもbase64url)を "." で連結した1本の文字列。
export function encryptRefreshToken(plainText) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(buf => buf.toString("base64url")).join(".");
}

export function decryptRefreshToken(encoded) {
  const key = getEncryptionKey();
  const parts = (encoded || "").split(".");
  if (parts.length !== 3) {
    throw new Error("保存されているGmailのrefresh tokenの形式が不正です");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(authTagB64, "base64url");
  const ciphertext = Buffer.from(ciphertextB64, "base64url");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10分

// このアプリのAPIルートはBearerトークン都度検証のみでサーバー側セッションを持たないため、
// OAuthのstateパラメータ自体に「誰が」「いつまで」有効かを載せ、GOOGLE_CLIENT_SECRETで
// HMAC署名する自己完結型のCSRF対策にする(Dropbox連携のsignOAuthState/verifyOAuthStateと同じ方式)。
export function signOAuthState(userId) {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET が設定されていません");
  const nonce = crypto.randomBytes(9).toString("base64url");
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  const payload = `${userId}.${nonce}.${expiresAt}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${hmac}`;
}

// 検証OK時はuserIdを返し、NG(改ざん・期限切れ・形式不正)時はnullを返す。
export function verifyOAuthState(state) {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret || !state) return null;
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, expiresAtStr, hmac] = parts;
  const payload = `${userId}.${nonce}.${expiresAtStr}`;
  const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(hmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return userId;
}
