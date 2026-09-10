import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveOwnerUserId } from "@/lib/ownerUser";
import { createGmailClient, listRecentMessageIds, getMessageDetail } from "@/lib/gmail";
import { decryptRefreshToken } from "@/lib/gmailAccountAuth";
import { classifyInquiry } from "@/lib/gemini";

// GitHub Actionsのscheduled workflow(.github/workflows/poll-inquiries.yml)から
// 数分〜十数分おきに呼ばれる「受信→AI判定→保存」パイプライン(指示書セクション4・5・6・9)。
// オーナーに紐づく有効な(enabled=true)gmail_accountsを全件ループし、アカウントごとに
// 自分のlast_checked_atをカーソルにして処理する(複数アカウント対応)。
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

async function processAccount(admin, ownerId, account, threshold) {
  const lastCheckedAt = new Date(account.last_checked_at || Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000);
  const afterUnixSeconds = Math.floor(lastCheckedAt.getTime() / 1000);
  const runStartedAt = new Date();

  const refreshToken = decryptRefreshToken(account.refresh_token_encrypted);
  const gmail = createGmailClient(refreshToken);

  const messageIds = await listRecentMessageIds(gmail, afterUnixSeconds);
  const existingIds = await findExistingMessageIds(admin, ownerId, messageIds);
  const newIds = messageIds.filter(id => !existingIds.has(id));

  let saved = 0;
  let failed = 0;
  const errors = [];

  for (const messageId of newIds) {
    try {
      const detail = await getMessageDetail(gmail, messageId);
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
          gmail_account_id: account.id,
          mailbox_email: account.gmail_email,
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

  await admin.from("gmail_accounts").update({ last_checked_at: runStartedAt.toISOString() }).eq("id", account.id);

  return {
    accountEmail: account.gmail_email,
    checkedAfter: lastCheckedAt.toISOString(),
    fetched: messageIds.length,
    saved,
    skippedExisting: existingIds.size,
    failed,
    errors: errors.slice(0, 20),
  };
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

  const results = [];
  for (const account of accounts) {
    try {
      results.push(await processAccount(admin, ownerId, account, threshold));
    } catch (err) {
      results.push({ accountEmail: account.gmail_email, error: String(err?.message || err) });
    }
  }

  return NextResponse.json({ ok: true, accounts: results });
}
