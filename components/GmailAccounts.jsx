"use client";

import { useEffect, useState } from "react";
import { disconnectGmailAccount, listGmailAccounts, startGmailConnect, updateGmailAccount } from "@/lib/gmailAccountsApi";

const ERROR_MESSAGES = {
  invalid_state: "認可の有効期限が切れたか、不正なリクエストでした。もう一度お試しください。",
  missing_app_credentials: "サーバー側のGoogle OAuth設定(GOOGLE_CLIENT_ID/SECRET)が未設定です。",
  connect_failed: "アカウントの接続に失敗しました。時間をおいて再度お試しください。",
};

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// 案件の取得対象となるGmailアカウントを追加・確認・一時停止・解除するパネル。
// Google側の同意画面はフルページ遷移になるため、戻ってきた直後は
// URLの ?gmail_connected=1 / ?gmail_error=... を見て結果を表示し、URLはきれいに戻す。
export default function GmailAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null); // { type: "success" | "error", text }
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      setAccounts(await listGmailAccounts());
    } catch (err) {
      console.error("listGmailAccounts failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("gmail_connected");
    const error = params.get("gmail_error");
    if (connected) {
      setNotice({ type: "success", text: "Gmailアカウントを接続しました。" });
    } else if (error) {
      setNotice({ type: "error", text: ERROR_MESSAGES[error] || `接続に失敗しました(${error})` });
    }
    if (connected || error) {
      params.delete("gmail_connected");
      params.delete("gmail_error");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
    }
    refresh();
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const url = await startGmailConnect();
      window.location.href = url;
    } catch (err) {
      setNotice({ type: "error", text: err.message || "接続開始に失敗しました" });
      setConnecting(false);
    }
  }

  async function handleToggle(account) {
    setBusyId(account.id);
    try {
      await updateGmailAccount(account.id, { enabled: !account.enabled });
      await refresh();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "更新に失敗しました" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(account) {
    const next = window.prompt("表示名を入力してください", account.label || account.email);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === account.label) return;
    setBusyId(account.id);
    try {
      await updateGmailAccount(account.id, { label: trimmed });
      await refresh();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "更新に失敗しました" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(account) {
    const ok = window.confirm(
      `${account.label || account.email} との連携を解除しますか?\n今後このアカウントの新着メールは取り込まれなくなります(過去に取得済みの案件は残ります)。`
    );
    if (!ok) return;
    setBusyId(account.id);
    try {
      await disconnectGmailAccount(account.id);
      await refresh();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "解除に失敗しました" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="gmail-accounts">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="header-row">
        <h2>Gmail連携アカウント</h2>
        <button className="connect-btn" onClick={handleConnect} disabled={connecting}>
          {connecting ? "接続画面へ移動中…" : "+ Gmailアカウントを追加"}
        </button>
      </div>

      {notice && (
        <div className={`notice ${notice.type}`}>
          {notice.text}
          <button className="notice-close" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {loading && <div className="loading-note">読み込み中…</div>}

      {!loading && accounts.length === 0 && (
        <div className="empty-note">まだGmailアカウントが接続されていません。「+ Gmailアカウントを追加」から追加してください。</div>
      )}

      {!loading && accounts.length > 0 && (
        <ul className="account-list">
          {accounts.map(account => (
            <li key={account.id} className={`account-row ${account.enabled ? "" : "disabled"}`}>
              <div className="account-info">
                <button className="account-label" onClick={() => handleRename(account)} title="クリックして表示名を変更">
                  {account.label || account.email}
                </button>
                <span className="account-email">{account.email}</span>
                <span className="account-meta">最終取得: {formatDateTime(account.lastCheckedAt)}</span>
              </div>
              <div className="account-actions">
                <button className="toggle-btn" disabled={busyId === account.id} onClick={() => handleToggle(account)}>
                  {account.enabled ? "一時停止" : "再開"}
                </button>
                <button className="disconnect-btn" disabled={busyId === account.id} onClick={() => handleDisconnect(account)}>
                  解除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CSS = `
.gmail-accounts {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 16px 0;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Zen Kaku Gothic New', sans-serif;
  color: #211F1A;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.header-row h2 {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}
.connect-btn {
  background: #4C6C57;
  color: #FBFAF6;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.connect-btn:disabled { opacity: 0.6; cursor: default; }
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  margin-bottom: 10px;
}
.notice.success { background: #E4EEE8; color: #2F5D46; }
.notice.error { background: #F4E1DE; color: #8A3A2E; }
.notice-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: inherit;
  line-height: 1;
}
.loading-note, .empty-note {
  padding: 10px 2px;
  color: #837E71;
  font-size: 12.5px;
}
.account-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  border: 1px solid #E4E0D6;
  border-radius: 10px;
  overflow: hidden;
}
.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid #EFECE3;
  background: #FBFAF6;
}
.account-row:last-child { border-bottom: none; }
.account-row.disabled { background: #F3F1EA; opacity: 0.75; }
.account-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.account-label {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  font-weight: 700;
  color: #211F1A;
  cursor: pointer;
  font-family: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.account-email { font-size: 12px; color: #837E71; }
.account-meta { font-size: 11.5px; color: #A39E90; }
.account-actions { display: flex; gap: 6px; flex-shrink: 0; }
.toggle-btn, .disconnect-btn {
  border: 1px solid #DAD5C8;
  background: #FFFFFF;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  color: #5A564B;
}
.disconnect-btn { color: #8A3A2E; border-color: #E6C9C3; }
.toggle-btn:disabled, .disconnect-btn:disabled { opacity: 0.5; cursor: default; }
`;
