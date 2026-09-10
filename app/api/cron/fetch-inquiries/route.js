import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveOwnerUserId } from "@/lib/ownerUser";
import { listRecentMessageIds, getMessageDetail } from "@/lib/gmail";
import { classifyInquiry } from "@/lib/gemini";

// GitHub Actionsのscheduled workflow(.github/workflows/poll-inquiries.yml)から
// 数分〜十数分おきに呼ばれる「受信→AI判定→保存」パイプライン(指示書セクション4・5・6・9)。
// Vercel HobbyプランはCron自体の実行頻度が1日1回に制限されるため、Vercel Cronではなく
// GitHub Actions側からAuthorization: Bearer $CRON_SECRETを付けて叩く方式にしている
// (将来Pro化した場合はvercel.jsonのcronからこのルートをそのまま流用できる)。
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_LOOKBACK_HOURS = 24;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

async function loadLastCheckedAt(admin, ownerId) {
  const { data } = await admin
    .from("inquiry_sync_state")
    .select("last_checked_at")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (data?.last_checked_at) return new Date(data.last_checked_at);
  return new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000);
}

async function findExistingMessageIds(admin, ownerId, messageIds) {
  if (messageIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("inquiries")
    .select("source_message_id")
    .eq("user_id", ownerId)
    .in("source_message_id", messageIds);
  if (error) throw error;
  return new Set((data || []).map(r => r.source_message_id));
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

  const lastCheckedAt = await loadLastCheckedAt(admin, ownerId);
  const afterUnixSeconds = Math.floor(lastCheckedAt.getTime() / 1000);
  const runStartedAt = new Date();

  let messageIds = [];
  try {
    messageIds = await listRecentMessageIds(afterUnixSeconds);
  } catch (err) {
    return NextResponse.json({ error: `Gmail取得に失敗しました: ${String(err?.message || err)}` }, { status: 500 });
  }

  const existingIds = await findExistingMessageIds(admin, ownerId, messageIds);
  const newIds = messageIds.filter(id => !existingIds.has(id));

  let saved = 0;
  let skippedExisting = existingIds.size;
  let failed = 0;
  const errors = [];

  for (const messageId of newIds) {
    try {
      const detail = await getMessageDetail(messageId);
      let classification;
      try {
        classification = await classifyInquiry({
          subject: detail.subject,
          senderName: detail.senderName,
          senderEmail: detail.senderEmail,
          bodyText: detail.bodyText,
        });
      } catch (err) {
        // Gemini呼び出し自体が失敗した場合も、レコードは残して後で精度検証できるようにする。
        errors.push(`gemini(${messageId}): ${String(err?.message || err)}`);
        classification = null;
      }

      const isInquiry = !!classification && classification.isJobInquiry && classification.confidenceScore >= threshold;

      const { error: insertError } = await admin.from("inquiries").upsert(
        {
          user_id: ownerId,
          received_at: detail.receivedAt,
          sender_name: detail.senderName,
          sender_email: detail.senderEmail,
          subject: detail.subject,
          summary: classification?.summary || "(AI分類に失敗しました)",
          project_name: classification?.projectName ?? null,
          expected_deadline: classification?.expectedDeadline ?? null,
          expected_rate: classification?.expectedRate ?? null,
          confidence_score: classification?.confidenceScore ?? 0,
          status: isInquiry ? "未確認" : "非依頼",
          source_message_id: messageId,
          source_channel: "email",
          raw_body_snippet: (detail.bodyText || "").slice(0, 1000),
        },
        { onConflict: "user_id,source_message_id", ignoreDuplicates: true }
      );
      if (insertError) throw insertError;
      saved += 1;
    } catch (err) {
      failed += 1;
      errors.push(`message(${messageId}): ${String(err?.message || err)}`);
    }
  }

  await admin
    .from("inquiry_sync_state")
    .upsert({ user_id: ownerId, last_checked_at: runStartedAt.toISOString() }, { onConflict: "user_id" });

  return NextResponse.json({
    ok: true,
    checkedAfter: lastCheckedAt.toISOString(),
    fetched: messageIds.length,
    saved,
    skippedExisting,
    failed,
    errors: errors.slice(0, 20),
  });
}
