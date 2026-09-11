import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { consolidateThreads } from "@/lib/threadConsolidation";

// 一覧画面の「重複を統合」ボタンから呼ばれる。スレッド機能導入より前に別行として保存されて
// しまった返信メールを、GmailのthreadIdを手がかりに元の依頼行へ統合する(行は削除せず
// merged_into_idを付けて一覧から隠すだけ)。何度実行しても安全(未処理分だけを毎回拾う)。
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const accounts = await consolidateThreads(admin, userId);
    return NextResponse.json({ ok: true, accounts });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
