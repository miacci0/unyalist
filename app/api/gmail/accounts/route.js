import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

// 接続済みGmailアカウントの一覧を返す。gmail_accountsはRLSポリシーが無くservice-role専用
// のため、クライアントから直接読めずこのAPIを経由する必要がある(refresh tokenそのものは
// 決して返さない)。
export async function POST(request) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("gmail_accounts")
    .select("id, label, gmail_email, enabled, last_checked_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "アカウント一覧の取得に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    accounts: (data || []).map(row => ({
      id: row.id,
      label: row.label,
      email: row.gmail_email,
      enabled: row.enabled,
      lastCheckedAt: row.last_checked_at,
      connectedAt: row.created_at,
    })),
  });
}
