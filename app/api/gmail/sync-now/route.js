import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { syncAccounts } from "@/lib/gmailSync";

// ログイン中ユーザー自身のGmailアカウントをその場で即時同期する(cronの最大15分待ちを
// 挟まずに「この日数分を再取得」ボタンの結果をすぐ確認できるようにするため)。
// bodyに{ accountId }を指定すればそのアカウントだけ、省略時は自分の有効な全アカウントを対象にする。
// 中身はapp/api/cron/fetch-inquiries/route.jsと同じlib/gmailSync.jsを使い回している
// (認証方式だけが違う: あちらはCRON_SECRET、こちらはログインセッションのBearerトークン)。
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.6);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("gmail_accounts")
    .select("id, gmail_email, refresh_token_encrypted, last_checked_at")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (typeof body.accountId === "string" && body.accountId) {
    query = query.eq("id", body.accountId);
  }

  const { data: accounts, error: accountsError } = await query;
  if (accountsError) {
    return NextResponse.json({ error: "gmail_accountsの取得に失敗しました" }, { status: 500 });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: "対象の(有効な)Gmailアカウントが見つかりません" }, { status: 404 });
  }

  const results = await syncAccounts(admin, userId, accounts, threshold);
  return NextResponse.json({ ok: true, accounts: results });
}
