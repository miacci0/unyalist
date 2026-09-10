"use client";

import AuthGate from "@/components/AuthGate";
import GmailAccounts from "@/components/GmailAccounts";
import InquiryList from "@/components/InquiryList";

export default function Page() {
  return (
    <AuthGate>
      <GmailAccounts />
      <InquiryList />
    </AuthGate>
  );
}
