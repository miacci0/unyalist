"use client";

import { supabase } from "@/lib/supabaseClient";

// app/api/gmail/{oauth/start, accounts, accounts/[id]}向けのfetchラッパー。
// このアプリにはサーバー側セッションが無いため、Supabaseログインセッションの
// access_tokenを毎回Authorization: Bearerヘッダーに載せて送る
// (animator-workspace-app/lib/dropboxReportStorage.jsと同じ方式)。

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("ログインしていません");
  return accessToken;
}

async function callApi(path, { method = "POST", body } = {}) {
  const accessToken = await getAccessToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "リクエストに失敗しました");
  return data;
}

export async function listGmailAccounts() {
  const data = await callApi("/api/gmail/accounts");
  return data.accounts || [];
}

// 呼び出し元でwindow.location.href = urlしてフルナビゲーションすること。
export async function startGmailConnect() {
  const data = await callApi("/api/gmail/oauth/start");
  if (!data.url) throw new Error("同意画面URLを取得できませんでした");
  return data.url;
}

export async function updateGmailAccount(id, patch) {
  return callApi(`/api/gmail/accounts/${id}`, { method: "PATCH", body: patch });
}

export async function disconnectGmailAccount(id) {
  return callApi(`/api/gmail/accounts/${id}`, { method: "DELETE" });
}

// 「この日数分を再取得」ボタン用。cronの最大15分待ちを挟まず、その場で同期を実行する。
// 戻り値のaccounts[0]に{fetched, saved, skippedExisting, failed, remaining, cursorAdvanced}が入る。
export async function syncGmailAccount(id) {
  const data = await callApi("/api/gmail/sync-now", { method: "POST", body: { accountId: id } });
  return data.accounts?.[0] || null;
}
