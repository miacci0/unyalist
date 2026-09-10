import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { verifyOAuthState, encryptRefreshToken } from "@/lib/gmailAccountAuth";
import { createGmailClient, getProfileEmail } from "@/lib/gmail";
import { getRequestOrigin } from "@/lib/requestOrigin";

// Googleの同意画面からユーザーが戻ってくるリダイレクト先。ブラウザからの直接遷移
// (GETリクエスト)のため、他のAPIルートと違いAuthorizationヘッダーは無い
// (誰の操作かはstateパラメータ自体に載っている。app/api/gmail/oauth/start/route.jsの
// signOAuthState参照)。このアプリには単一ページしか無いため、成功/失敗いずれも
// "/"へクエリパラメータ付きでリダイレクトし、続きはクライアント側
// (components/GmailAccounts.jsxのマウント時処理)に委ねる。
export const runtime = "nodejs";

export async function GET(request) {
  const origin = getRequestOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  if (googleError) {
    return NextResponse.redirect(`${origin}/?gmail_error=${encodeURIComponent(googleError)}`);
  }

  const userId = verifyOAuthState(state);
  if (!userId || !code) {
    return NextResponse.redirect(`${origin}/?gmail_error=invalid_state`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?gmail_error=missing_app_credentials`);
  }

  try {
    const redirectUri = `${origin}/api/gmail/oauth/callback`;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Googleからrefresh tokenが返されませんでした(既に同じアカウントで連携済みの場合、Googleアカウントの" +
          "「サードパーティ製アプリとサービスへのアクセス」からUnyaListへのアクセスを一度取り消してから再度お試しください)"
      );
    }

    const gmail = createGmailClient(tokens.refresh_token);
    const gmailEmail = await getProfileEmail(gmail);
    if (!gmailEmail) throw new Error("Gmailアカウントのメールアドレスを取得できませんでした");

    const refreshTokenEncrypted = encryptRefreshToken(tokens.refresh_token);

    const admin = createSupabaseAdminClient();
    // 既に同じアドレスで接続済み(再認可)の場合、ユーザーが変更済みかもしれないlabelは
    // 上書きしない。新規接続時だけgmail_emailをそのままlabelの初期値にする。
    const { data: existing } = await admin
      .from("gmail_accounts")
      .select("label")
      .eq("user_id", userId)
      .eq("gmail_email", gmailEmail)
      .maybeSingle();

    const { error } = await admin.from("gmail_accounts").upsert(
      {
        user_id: userId,
        gmail_email: gmailEmail,
        label: existing?.label || gmailEmail,
        refresh_token_encrypted: refreshTokenEncrypted,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,gmail_email" }
    );
    if (error) throw error;
  } catch (err) {
    console.error("[Gmail OAuth callback]", err);
    return NextResponse.redirect(`${origin}/?gmail_error=connect_failed`);
  }

  return NextResponse.redirect(`${origin}/?gmail_connected=1`);
}
