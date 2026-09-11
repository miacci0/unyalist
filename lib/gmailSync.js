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

// 「処理済み(=もう取り込む必要がない)」メッセージIDの集合を返す。独立した1件として
// inquiries行そのものになったもの(source_message_id一致)と、既存スレッドへの返信として
// merged_message_idsに追記済みのものの両方を対象にする。
export async function findExistingMessageIds(admin, ownerId, messageIds) {
  if (messageIds.length === 0) return new Set();
  const [{ data: bySource, error: sourceError }, { data: byMerged, error: mergedError }] = await Promise.all([
    admin.from("inquiries").select("source_message_id").eq("user_id", ownerId).in("source_message_id", messageIds),
    admin.from("inquiries").select("merged_message_ids").eq("user_id", ownerId).overlaps("merged_message_ids", messageIds),
  ]);
  if (sourceError) throw sourceError;
  if (mergedError) throw mergedError;

  const handled = new Set((bySource || []).map(r => r.source_message_id));
  const messageIdSet = new Set(messageIds);
  for (const row of byMerged || []) {
    for (const id of row.merged_message_ids || []) {
      if (messageIdSet.has(id)) handled.add(id);
    }
  }
  return handled;
}

// このアカウントで既にthread_idが分かっている案件行を { threadId -> inquiryId } で引けるようにする。
// 新規メッセージ1件ごとにDBへ問い合わせるのではなく、アカウント処理の最初に1回だけまとめて取得する。
async function loadThreadIndex(admin, ownerId, accountId) {
  const { data, error } = await admin
    .from("inquiries")
    .select("id, thread_id")
    .eq("user_id", ownerId)
    .eq("gmail_account_id", accountId)
    .not("thread_id", "is", null);
  if (error) throw error;
  const index = new Map();
  for (const row of data || []) index.set(row.thread_id, row.id);
  return index;
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
  const threadIndex = await loadThreadIndex(admin, ownerId, account.id);

  const fullyDrained = newIds.length <= PROCESS_LIMIT;
  const idsToProcess = fullyDrained ? newIds : newIds.slice(0, PROCESS_LIMIT);

  let saved = 0;
  let merged = 0; // 既存スレッドへの返信として取り込んだ件数(新規行は作らない)
  let failed = 0;
  let pendingRetry = 0; // 分類できず保存を見送った件数(次回実行で再挑戦される)
  let stoppedEarly = false;
  const errors = [];

  for (const messageId of idsToProcess) {
    let classification;
    let classifyError = null;
    try {
      const detail = await getMessageDetail(gmail, messageId);

      // 既知のスレッド(=既存の依頼行)の続きであれば、返信メール1通ずつを新規案件として
      // 分類・保存しない。元の行にメッセージIDだけ追記し、次回以降の重複取り込みを防ぐ。
      const existingInquiryId = detail.threadId ? threadIndex.get(detail.threadId) : undefined;
      if (existingInquiryId) {
        const { error: appendError } = await admin.rpc("append_thread_message", {
          p_inquiry_id: existingInquiryId,
          p_message_id: messageId,
        });
        if (appendError) throw appendError;
        merged += 1;
        continue;
      }

      try {
        classification = await classifyInquiry({
          subject: detail.subject,
          senderName: detail.senderName,
          senderEmail: detail.senderEmail,
          bodyText: detail.bodyText,
        });
      } catch (err) {
        classifyError = err;
      }

      // 分類できなかった場合(API側の一時的な障害・レート制限・応答の解析失敗など、いずれも
      // メールの内容とは無関係)は、レコードごと保存を見送る。ここで「非依頼」として保存して
      // しまうと、重複防止の仕組み上ずっと再取得されず、本物の依頼メールを取りこぼしたまま
      // 気づけなくなる(過去にresponseSchemaの不整合・対応終了モデル・レート制限のいずれでも
      // 実際に発生した)。last_checked_atをこのメッセージより先に進めないことで、次回の
      // cron実行(または「再取得」ボタン)で自動的に再挑戦される。
      if (!classification) {
        pendingRetry += 1;
        const message = classifyError ? String(classifyError.message || classifyError).slice(0, 200) : "分類結果を解釈できませんでした";
        errors.push(`gemini(${messageId}): ${message}`);
        // 429(レート制限)は数回リトライしても解消しないことが多く、同じ実行内で残りを
        // 処理し続けても同じ失敗を繰り返すだけになりやすいので、その回のバッチはここで打ち切る。
        if (classifyError?.status === 429) {
          stoppedEarly = true;
          break;
        }
        continue;
      }

      const isInquiry = classification.isJobInquiry && classification.confidenceScore >= threshold;

      const { data: insertedRow, error: insertError } = await admin
        .from("inquiries")
        .upsert(
          {
            user_id: ownerId,
            gmail_account_id: account.id,
            mailbox_email: account.gmail_email,
            received_at: detail.receivedAt,
            sender_name: detail.senderName,
            sender_email: detail.senderEmail,
            subject: detail.subject,
            summary: classification.summary,
            project_name: classification.projectName,
            expected_deadline: classification.expectedDeadline,
            expected_rate: classification.expectedRate,
            confidence_score: classification.confidenceScore,
            status: isInquiry ? "未確認" : "非依頼",
            source_message_id: messageId,
            source_channel: "email",
            raw_body_snippet: (detail.bodyText || "").slice(0, 1000),
            thread_id: detail.threadId,
          },
          { onConflict: "user_id,source_message_id", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;
      saved += 1;
      // 同じバッチ内で、この直後にこのスレッドへの返信が続けて見つかった場合にも
      // 新規行を作らず追記できるよう、その場でインデックスへ反映しておく。
      if (detail.threadId && insertedRow?.id) threadIndex.set(detail.threadId, insertedRow.id);
    } catch (err) {
      // Gmail取得やSupabase書き込みなど、分類とは別の理由での失敗。これもメッセージ自体は
      // 未保存のままなので、次回実行で再挑戦される(pendingRetryと同じ扱い)。
      failed += 1;
      errors.push(`message(${messageId}): ${String(err?.message || err)}`);
    }
  }

  // このバッチで見つかった新規メッセージを1件も取りこぼさず処理しきれた時だけカーソルを進める。
  // 途中で打ち切った・分類に失敗したメッセージが残っている場合はlast_checked_atを据え置き、
  // 次回実行で同じ範囲を再検索する(既に保存済みの分はfindExistingMessageIdsで自動的にスキップされる)。
  const fullyProcessed = fullyDrained && pendingRetry === 0 && failed === 0 && !stoppedEarly;
  if (fullyProcessed) {
    await admin.from("gmail_accounts").update({ last_checked_at: runStartedAt.toISOString() }).eq("id", account.id);
  }

  return {
    accountEmail: account.gmail_email,
    checkedAfter: lastCheckedAt.toISOString(),
    fetched: messageIds.length,
    saved,
    merged,
    skippedExisting: existingIds.size,
    pendingRetry,
    failed,
    // 発見した新規メッセージのうち、まだ処理できていない件数(次回実行以降で追いつく)。
    remaining: newIds.length - saved - merged,
    cursorAdvanced: fullyProcessed,
    errors: errors.slice(0, 20),
  };
}

// アカウントごとに並行して同期する(直列にすると、片方のアカウントでGemini呼び出しの
// リトライ待ちが発生した際、それだけ他方のアカウント分の処理も後ろにずれて全体の実行時間が
// 伸びてしまい、Vercel関数の実行時間上限に達しやすくなるため)。1アカウントの失敗が
// 他のアカウントの処理を止めないよう、Promise.allSettledで各アカウント独立に結果をまとめる。
export async function syncAccounts(admin, ownerId, accounts, threshold) {
  const settled = await Promise.allSettled(accounts.map(account => syncAccount(admin, ownerId, account, threshold)));
  return settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : { accountEmail: accounts[i].gmail_email, error: String(result.reason?.message || result.reason) }
  );
}
