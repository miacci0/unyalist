import { createGmailClient, getMessageThreadId } from "@/lib/gmail";
import { decryptRefreshToken } from "@/lib/gmailAccountAuth";

// 「重複を統合」ボタンの中身。スレッド機能(thread_id/merged_message_ids)導入より前に
// 保存されてしまった返信メールの行を、GmailのthreadIdを手がかりに元の依頼行へ統合する。
// app/api/gmail/sync-now/route.jsと同じくログインセッション認証から呼ばれる、
// lib/gmailSync.jsの通常の受信パイプラインとは別系統の一回限りの整理用ロジック。

// 1回の実行でGmail APIに問い合わせてthread_idを後付けする件数の上限。多すぎる場合は
// 「remaining」として返し、ボタンをもう一度押せば続きが処理される(cronのPROCESS_LIMITと同じ考え方)。
const MAX_BACKFILL_PER_ACCOUNT = 150;

export async function consolidateThreads(admin, ownerId) {
  const { data: accounts, error: accountsError } = await admin
    .from("gmail_accounts")
    .select("id, gmail_email, refresh_token_encrypted")
    .eq("user_id", ownerId);
  if (accountsError) throw accountsError;

  const results = [];
  for (const account of accounts || []) {
    try {
      results.push(await consolidateAccountThreads(admin, ownerId, account));
    } catch (err) {
      results.push({ accountEmail: account.gmail_email, error: String(err?.message || err) });
    }
  }
  return results;
}

async function consolidateAccountThreads(admin, ownerId, account) {
  const { data: rows, error: rowsError } = await admin
    .from("inquiries")
    .select("id, thread_id, received_at, source_message_id")
    .eq("user_id", ownerId)
    .eq("gmail_account_id", account.id)
    .is("merged_into_id", null);
  if (rowsError) throw rowsError;

  const withThreadId = [];
  const needsThreadId = [];
  for (const row of rows || []) {
    if (row.thread_id) withThreadId.push(row);
    else needsThreadId.push(row);
  }

  let backfilled = 0;
  let backfillFailed = 0;
  const toBackfill = needsThreadId.slice(0, MAX_BACKFILL_PER_ACCOUNT);
  const remaining = needsThreadId.length - toBackfill.length;

  if (toBackfill.length > 0) {
    const refreshToken = decryptRefreshToken(account.refresh_token_encrypted);
    const gmail = createGmailClient(refreshToken);
    for (const row of toBackfill) {
      try {
        const threadId = await getMessageThreadId(gmail, row.source_message_id);
        if (!threadId) continue; // Gmail側で見つからない(削除済みなど)場合はスキップ
        const { error: updateError } = await admin.from("inquiries").update({ thread_id: threadId }).eq("id", row.id);
        if (updateError) throw updateError;
        row.thread_id = threadId;
        withThreadId.push(row);
        backfilled += 1;
      } catch (err) {
        backfillFailed += 1;
      }
    }
  }

  // thread_idごとにグループ化し、複数行あるものだけが統合対象。
  const groups = new Map();
  for (const row of withThreadId) {
    if (!groups.has(row.thread_id)) groups.set(row.thread_id, []);
    groups.get(row.thread_id).push(row);
  }

  let threadsMerged = 0;
  let rowsHidden = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
    const [primary, ...duplicates] = group;
    let anyMerged = false;
    for (const dup of duplicates) {
      const { error: appendError } = await admin.rpc("append_thread_message", {
        p_inquiry_id: primary.id,
        p_message_id: dup.source_message_id,
      });
      if (appendError) throw appendError;
      const { error: hideError } = await admin.from("inquiries").update({ merged_into_id: primary.id }).eq("id", dup.id);
      if (hideError) throw hideError;
      rowsHidden += 1;
      anyMerged = true;
    }
    if (anyMerged) threadsMerged += 1;
  }

  return {
    accountEmail: account.gmail_email,
    threadsMerged,
    rowsHidden,
    backfilled,
    backfillFailed,
    remaining,
  };
}
