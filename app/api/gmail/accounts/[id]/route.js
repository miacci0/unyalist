import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

// 接続済みGmailアカウント1件のラベル変更・有効/無効切替・遡り再取得(PATCH)・解除(DELETE)。
// 対象行がリクエスト元userIdの所有か(.eq("user_id", userId))を必ず確認してから操作する。

const MIN_REWIND_DAYS = 1;
const MAX_REWIND_DAYS = 90;

export async function PATCH(request, { params }) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body.label === "string") patch.label = body.label.slice(0, 100) || null;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

  const admin = createSupabaseAdminClient();

  // rewindDays: 「この日数分を再取得」ボタン用。last_checked_atを(今より古い場合のみ)
  // now - rewindDays日 まで巻き戻す。誤って前進させて取りこぼさないよう、現在値より
  // 新しくなる場合は何もしない(この場合はエラーではなく「既に対象範囲内」としてok扱いにする)。
  let rewindRequested = false;
  let rewindApplied = false;
  if (body.rewindDays !== undefined) {
    rewindRequested = true;
    const days = Math.min(MAX_REWIND_DAYS, Math.max(MIN_REWIND_DAYS, Number(body.rewindDays) || 0));
    if (!days) {
      return NextResponse.json({ error: "rewindDaysの値が不正です" }, { status: 400 });
    }
    const { data: current, error: fetchError } = await admin
      .from("gmail_accounts")
      .select("last_checked_at")
      .eq("id", params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchError || !current) {
      return NextResponse.json({ error: "対象のアカウントが見つかりません" }, { status: 404 });
    }
    const candidate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const existing = current.last_checked_at ? new Date(current.last_checked_at) : null;
    if (!existing || candidate < existing) {
      patch.last_checked_at = candidate.toISOString();
      rewindApplied = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    // rewindDaysだけが指定され、既にその範囲をカバー済みだった場合はエラーではなく成功扱いにする。
    if (rewindRequested && !rewindApplied) {
      return NextResponse.json({ ok: true, rewound: false });
    }
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

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
