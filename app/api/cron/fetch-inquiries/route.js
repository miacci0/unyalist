import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveOwnerUserId } from "@/lib/ownerUser";
import { syncAccounts } from "@/lib/gmailSync";

// GitHub Actionsのscheduled workflow(.github/workflows/poll-inquiries.yml)から
// 数分〜十数分おきに呼ばれる「受信→AI判定→保存」パイプライン(指示書セクション4・5・6・9)。
// オーナーに紐づく有効な(enabled=true)gmail_accountsを全件ループし、アカウントごとに
// 自分のlast_checked_atをカーソルにして処理する(複数アカウント対応)。実際の同期処理は
// lib/gmailSync.jsを app/api/gmail/sync-now/route.js(手動即時同期)と共用している。
// Vercel HobbyプランはCron自体の実行頻度が1日1回に制限されるため、Vercel Cronではなく
// GitHub Actions側からAuthorization: Bearer $CRON_SECRETを付けて叩く方式にしている
// (将来Pro化した場合はvercel.jsonのcronからこのルートをそのまま流用できる)。
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.6);

  let ownerId;
  try {
    ownerId = await resolveOwnerUserId(admin);
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }

  const { data: accounts, error: accountsError } = await admin
    .from("gmail_accounts")
    .select("id, gmail_email, refresh_token_encrypted, last_checked_at")
    .eq("user_id", ownerId)
    .eq("enabled", true);
  if (accountsError) {
    return NextResponse.json({ error: "gmail_accountsの取得に失敗しました" }, { status: 500 });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ ok: true, accounts: [], note: "接続済みの有効なGmailアカウントがありません" });
  }

  const results = await syncAccounts(admin, ownerId, accounts, threshold);
  return NextResponse.json({ ok: true, accounts: results });
}
