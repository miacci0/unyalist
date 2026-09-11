"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// inquiries(RLSでuser_idごとに分離)を読み書きするデータ層。行単位のテーブルで、
// 個人利用・低頻度更新のため素朴なselect/updateをそのまま使う(routine_tasksと同じ方針、
// 楽観ロックは持たせていない)。書き込みはcron(service role)のみがinsertし、
// このアプリからはstatus更新のみ行う想定なのでinsert/deleteは実装しない。

export const ALL_STATUSES = ["未確認", "検討中", "返信済み", "保留", "成立", "不成立", "非依頼"];
export const DEFAULT_VISIBLE_STATUSES = ["未確認", "検討中"];

function inquiryFromRow(row) {
  return {
    id: row.id,
    receivedAt: row.received_at,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    subject: row.subject,
    summary: row.summary,
    projectName: row.project_name,
    expectedDeadline: row.expected_deadline,
    expectedRate: row.expected_rate,
    confidenceScore: row.confidence_score,
    status: row.status,
    sourceMessageId: row.source_message_id,
    sourceChannel: row.source_channel,
    gmailAccountId: row.gmail_account_id,
    mailboxEmail: row.mailbox_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function useInquiries() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | syncing | error

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    // merged_into_idが付いている行は「重複を統合」で元の依頼行へ統合済みなので一覧に出さない
    // (行自体は削除していないので、DB上には残っている)。
    const { data, error } = await supabase
      .from("inquiries")
      .select("*")
      .is("merged_into_id", null)
      .order("received_at", { ascending: false });
    if (error) {
      console.error("inquiries load failed", error);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setInquiries((data || []).map(inquiryFromRow));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = useCallback(async (id, newStatus) => {
    setStatus("syncing");
    // 体感の速さのため楽観的にローカルへ反映する(個人利用の低頻度操作なので厳密なロールバックはしない)。
    setInquiries(prev => prev.map(inq => (inq.id === id ? { ...inq, status: newStatus } : inq)));
    const { error } = await supabase
      .from("inquiries")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("updateStatus failed", error);
      setStatus("error");
      return false;
    }
    setStatus("idle");
    return true;
  }, []);

  return { loading, loadFailed, saveStatus: status, inquiries, updateStatus, refresh: load };
}
