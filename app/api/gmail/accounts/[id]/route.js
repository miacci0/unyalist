import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

// 接続済みGmailアカウント1件のラベル変更・有効/無効切替(PATCH)・解除(DELETE)。
// 対象行がリクエスト元userIdの所有か(.eq("user_id", userId))を必ず確認してから操作する。

export async function PATCH(request, { params }) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body.label === "string") patch.label = body.label.slice(0, 100) || null;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("gmail_accounts").update(patch).eq("id", params.id).eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("gmail_accounts").delete().eq("id", params.id).eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: "解除に失敗しました" }, { status: 500 });
  }
  // inquiries.gmail_account_idはon delete set nullなので、過去の取得履歴(mailbox_email含む)は
  // 消えずに残る(呼び出し元のUIでもその旨を確認ダイアログに出す)。
  return NextResponse.json({ ok: true });
}
