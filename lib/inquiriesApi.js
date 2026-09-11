"use client";

import { supabase } from "@/lib/supabaseClient";

// app/api/inquiries/*向けのfetchラッパー。lib/gmailAccountsApi.jsと同じく、
// Supabaseログインセッションのaccess_tokenをAuthorization: Bearerヘッダーで送る。

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("ログインしていません");
  return accessToken;
}

// 「重複を統合」ボタン用。既存の別行返信をGmailのthreadIdで元の依頼行へ統合する。
// 戻り値のaccounts配列に、アカウントごとの{threadsMerged, rowsHidden, remaining, ...}が入る。
export async function consolidateThreads() {
  const accessToken = await getAccessToken();
  const res = await fetch("/api/inquiries/consolidate-threads", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "統合に失敗しました");
  return data.accounts || [];
}
