import { createGmailClient, listRecentMessageIds, getMessageDetail } from "@/lib/gmail";
import { decryptRefreshToken } from "@/lib/gmailAccountAuth";
import { classifyInquiry } from "@/lib/gemini";

// 「受信→AI判定→保存」の中核ロジック。app/api/cron/fetch-inquiries/route.js(CRON_SECRET認証、
// 全有効アカウント巡回)と app/api/gmail/sync-now/route.js(ログインセッション認証、
// 「この日数分を再取得」ボタンからの即時実行)の両方から使う共通モジュール。

export const DEFAULT_LOOKBACK_HOURS = 24 * 7; // 新規接続直後などlast_checked_atが無い場合のフォールバック

// 1回の実行(1アカウントぶん)でAI分類まで行う件数の上限。Gmail取得+Gemini呼び出しは
// 1件あたり数百ms〜数秒かかるため、無制限に処理するとVercelの実行時間上限
// (maxDuration=60)を超えかねない。遡り日数を大きく指定してメール件数が上限を超えた場合は、
// 先頭PROCESS_LIMIT件だけ処理してlast_checked_atを進めずに終える。次回実行時も同じ
// after:条件で再検索されるが、既に保存済みのメッセージはfindExistingMessageIdsで
// 自動的にスキップされるため、残りが少しずつ処理されて最終的に追いつく(取りこぼさない)。
export const PROCESS_LIMIT = 30;

export async function findExistingMessageIds(admin, ownerId, messageIds) {
  if (messageIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("inquiries")
    .select("source_message_id")
    .eq("user_id", ownerId)
    .in("source_message_id", messageIds);
  if (error) throw error;
  return new Set((data || []).map(r => r.source_message_id));
}

// 1アカウント分を同期する。account には少なくとも
// { id, gmail_email, refresh_token_encrypted, last_checked_at } が必要。
export async function syncAccount(admin, ownerId, account, threshold) {
  const lastCheckedAt = new Date(account.last_checked_at || Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000);
  const afterUnixSeconds = Math.floor(lastCheckedAt.getTime() / 1000);
  const runStartedAt = new Date();

  const refreshToken = decryptRefreshToken(account.refresh_token_encrypted);
  const gmail = createGmailClient(refreshToken);

  const messageIds = await listRecentMessageIds(gmail, afterUnixSeconds);
  const existingIds = await findExistingMessageIds(admin, ownerId, messageIds);
  const newIds = messageIds.filter(id => !existingIds.has(id));

  const fullyDrained = newIds.length <= PROCESS_LIMIT;
  const idsToProcess = fullyDrained ? newIds : newIds.slice(0, PROCESS_LIMIT);

  let saved = 0;
  let failed = 0;
  const errors = [];

  for (const messageId of idsToProcess) {
    try {
      const detail = await getMessageDetail(gmail, messageId);
      let classification;
      let classifyErrorMessage = null;
      try {
        classification = await classifyInquiry({
          subject: detail.subject,
          senderName: detail.senderName,
          senderEmail: detail.senderEmail,
          bodyText: detail.bodyText,
        });
      } catch (err) {
        // Gemini呼び出し自体が失敗した場合も、レコードは残して後で精度検証できるようにする。
        // summaryに実際のエラー文も残しておくと、UI(一覧)を見るだけで原因を特定できる。
        classifyErrorMessage = String(err?.message || err).slice(0, 200);
        errors.push(`gemini(${messageId}): ${classifyErrorMessage}`);
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
          summary:
            classification?.summary ||
            (classifyErrorMessage ? `(AI分類に失敗しました: ${classifyErrorMessage})` : "(AI分類に失敗しました)"),
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

  // 全件処理しきれた時だけカーソルを進める。処理しきれなかった場合はlast_checked_atを
  // 据え置き、次回実行で残りを引き続き処理する(取りこぼし防止)。
  if (fullyDrained) {
    await admin.from("gmail_accounts").update({ last_checked_at: runStartedAt.toISOString() }).eq("id", account.id);
  }

  return {
    accountEmail: account.gmail_email,
    checkedAfter: lastCheckedAt.toISOString(),
    fetched: messageIds.length,
    saved,
    skippedExisting: existingIds.size,
    failed,
    remaining: fullyDrained ? 0 : newIds.length - idsToProcess.length,
    cursorAdvanced: fullyDrained,
    errors: errors.slice(0, 20),
  };
}

export async function syncAccounts(admin, ownerId, accounts, threshold) {
  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(admin, ownerId, account, threshold));
    } catch (err) {
      results.push({ accountEmail: account.gmail_email, error: String(err?.message || err) });
    }
  }
  return results;
}
