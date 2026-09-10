"use client";

import { useMemo, useState } from "react";
import { ALL_STATUSES, DEFAULT_VISIBLE_STATUSES, useInquiries } from "@/lib/useInquiries";

// 指示書セクション7の一覧UI。詳細画面への遷移を必須にせず、一覧上のボタンだけで
// ステータス操作が完結するようにする。締切・単価は目立たせすぎない(Animator Workspaceの
// 案件一覧と同じ思想)ため、太字や強い色を使わず控えめなテキストで表示する。

const STATUS_ACTIONS = {
  未確認: [
    { label: "依頼として確定", next: "検討中", tone: "primary" },
    { label: "違う", next: "非依頼", tone: "muted" },
  ],
  検討中: [{ label: "返信済みにする", next: "返信済み", tone: "primary" }],
  返信済み: [
    { label: "保留にする", next: "保留", tone: "muted" },
    { label: "成立にする", next: "成立", tone: "primary" },
    { label: "不成立にする", next: "不成立", tone: "muted" },
  ],
  保留: [
    { label: "成立にする", next: "成立", tone: "primary" },
    { label: "不成立にする", next: "不成立", tone: "muted" },
  ],
  成立: [],
  不成立: [],
  非依頼: [],
};

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function gmailLink(sourceMessageId) {
  if (!sourceMessageId) return null;
  return `https://mail.google.com/mail/u/0/#all/${sourceMessageId}`;
}

export default function InquiryList() {
  const { loading, loadFailed, saveStatus, inquiries, updateStatus, refresh } = useInquiries();
  const [visibleStatuses, setVisibleStatuses] = useState(new Set(DEFAULT_VISIBLE_STATUSES));
  // 複数Gmailアカウント対応: チップを外したアカウントだけを隠す方式にしておくと、
  // 新しいアカウントを追加してもここを触らない限り自動的に表示対象になる(デフォルト全表示)。
  const [hiddenAccounts, setHiddenAccounts] = useState(new Set());

  const accountOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const inq of inquiries) {
      if (inq.mailboxEmail && !seen.has(inq.mailboxEmail)) {
        seen.add(inq.mailboxEmail);
        list.push(inq.mailboxEmail);
      }
    }
    return list;
  }, [inquiries]);

  const filtered = useMemo(
    () =>
      inquiries.filter(
        inq => visibleStatuses.has(inq.status) && !(inq.mailboxEmail && hiddenAccounts.has(inq.mailboxEmail))
      ),
    [inquiries, visibleStatuses, hiddenAccounts]
  );

  function toggleStatus(s) {
    setVisibleStatuses(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function toggleAccount(email) {
    setHiddenAccounts(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  return (
    <div className="inquiry-list">
      <style dangerouslySetInnerHTML={{ __html: LIST_CSS }} />

      <div className="toolbar">
        <div className="filters">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              className={`filter-chip ${visibleStatuses.has(s) ? "active" : ""}`}
              onClick={() => toggleStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          {saveStatus === "syncing" && <span className="sync-note">保存中…</span>}
          {saveStatus === "error" && <span className="sync-note error">保存に失敗しました</span>}
          <button className="refresh-btn" onClick={refresh}>更新</button>
        </div>
      </div>

      {accountOptions.length > 1 && (
        <div className="filters account-filters">
          {accountOptions.map(email => (
            <button
              key={email}
              className={`filter-chip account-chip ${hiddenAccounts.has(email) ? "" : "active"}`}
              onClick={() => toggleAccount(email)}
            >
              {email}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="empty-note">読み込み中…</div>}
      {loadFailed && <div className="empty-note error">読み込みに失敗しました。時間をおいて再読み込みしてください。</div>}
      {!loading && !loadFailed && filtered.length === 0 && (
        <div className="empty-note">表示できる案件はありません。上のフィルタで表示するステータスを増やせます。</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>受信日時</th>
                <th>受信アカウント</th>
                <th>送信者</th>
                <th>件名 / 要約</th>
                <th>案件名</th>
                <th>希望納期</th>
                <th>単価</th>
                <th className="col-status-actions">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inq => {
                const link = gmailLink(inq.sourceMessageId);
                const actions = STATUS_ACTIONS[inq.status] || [];
                return (
                  <tr key={inq.id}>
                    <td className="col-date">{formatDateTime(inq.receivedAt)}</td>
                    <td className="col-account">
                      {inq.mailboxEmail ? <span className="account-badge">{inq.mailboxEmail}</span> : "—"}
                    </td>
                    <td className="col-sender">
                      <div>{inq.senderName || "(不明)"}</div>
                      <div className="muted-small">{inq.senderEmail}</div>
                    </td>
                    <td className="col-subject">
                      <div>
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer">{inq.subject || "(件名なし)"}</a>
                        ) : (
                          inq.subject || "(件名なし)"
                        )}
                      </div>
                      <div className="muted-small">{inq.summary}</div>
                    </td>
                    <td className="col-project">{inq.projectName || "—"}</td>
                    <td className="col-deadline muted-small">{inq.expectedDeadline || "—"}</td>
                    <td className="col-rate muted-small">{inq.expectedRate || "—"}</td>
                    <td className="col-status-actions">
                      <span className={`status-badge status-${inq.status}`}>{inq.status}</span>
                      <div className="action-buttons">
                        {actions.map(a => (
                          <button
                            key={a.label}
                            className={`action-btn ${a.tone}`}
                            onClick={() => updateStatus(inq.id, a.next)}
                          >
                            {a.label}
                          </button>
                        ))}
                        <select
                          className="status-select"
                          value=""
                          onChange={e => {
                            if (e.target.value) updateStatus(inq.id, e.target.value);
                          }}
                        >
                          <option value="">他のステータスへ…</option>
                          {ALL_STATUSES.filter(s => s !== inq.status).map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const LIST_CSS = `
.inquiry-list {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Zen Kaku Gothic New', sans-serif;
  color: #211F1A;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.filter-chip {
  border: 1px solid #DAD5C8;
  background: #FBFAF6;
  color: #837E71;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.filter-chip.active {
  background: #4C6C57;
  border-color: #4C6C57;
  color: #FBFAF6;
}
.account-filters { margin: -4px 0 14px; }
.account-chip.active { background: #5A6E8C; border-color: #5A6E8C; }
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.sync-note { color: #837E71; }
.sync-note.error { color: #B84A3E; }
.refresh-btn {
  border: 1px solid #DAD5C8;
  background: #FBFAF6;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.empty-note {
  padding: 32px 12px;
  text-align: center;
  color: #837E71;
  font-size: 13px;
}
.empty-note.error { color: #B84A3E; }
.table-scroll {
  overflow-x: auto;
  border: 1px solid #E4E0D6;
  border-radius: 10px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 900px;
}
thead th {
  text-align: left;
  padding: 10px 12px;
  background: #F1EEE5;
  color: #837E71;
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  border-bottom: 1px solid #E4E0D6;
}
tbody tr { background: #FBFAF6; }
tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #EFECE3;
  vertical-align: top;
}
tbody tr:last-child td { border-bottom: none; }
.col-date { white-space: nowrap; color: #837E71; font-size: 12px; }
.col-account { min-width: 130px; }
.account-badge {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: #E7EBF2;
  color: #3E4E68;
}
.col-sender { min-width: 140px; }
.col-subject { min-width: 260px; }
.col-subject a { color: #2F5D46; text-decoration: none; font-weight: 600; }
.col-subject a:hover { text-decoration: underline; }
.col-project { min-width: 120px; }
.col-deadline, .col-rate { min-width: 110px; }
.muted-small { color: #837E71; font-size: 12px; margin-top: 2px; }
.status-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  background: #EFECE3;
  color: #5A564B;
}
.status-badge.status-未確認 { background: #FCEFD9; color: #8A5A15; }
.status-badge.status-検討中 { background: #E4EEE8; color: #2F5D46; }
.status-badge.status-返信済み { background: #E2E9F4; color: #2E4A80; }
.status-badge.status-保留 { background: #EFECE3; color: #6B6656; }
.status-badge.status-成立 { background: #DEEFD9; color: #2E6B2E; }
.status-badge.status-不成立 { background: #F4E1DE; color: #8A3A2E; }
.status-badge.status-非依頼 { background: #EFECE3; color: #9C978A; }
/* ステータス+操作は右端に固定表示し、横スクロールしなくても常に見えるようにする
   (受信日時〜単価までの詳細列だけが .table-scroll の中でスクロールする)。 */
.col-status-actions {
  position: sticky;
  right: 0;
  z-index: 1;
  width: 210px;
  min-width: 210px;
  box-shadow: -6px 0 6px -6px rgba(33, 31, 26, 0.18);
}
th.col-status-actions { background: #F1EEE5; z-index: 2; }
td.col-status-actions { background: #FBFAF6; display: table-cell; }
tbody tr:hover td.col-status-actions { background: #FBFAF6; }
.col-status-actions .status-badge { display: block; width: fit-content; margin-bottom: 6px; }
.action-buttons { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.action-btn {
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}
.action-btn.primary { background: #4C6C57; color: #FBFAF6; }
.action-btn.muted { background: #EFECE3; color: #5A564B; }
.status-select {
  border: 1px solid #DAD5C8;
  border-radius: 6px;
  padding: 5px 6px;
  font-size: 12px;
  font-family: inherit;
  color: #837E71;
  background: #FBFAF6;
}
`;
