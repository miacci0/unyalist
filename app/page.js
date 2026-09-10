"use client";

import AuthGate from "@/components/AuthGate";
import InquiryList from "@/components/InquiryList";

export default function Page() {
  return (
    <AuthGate>
      <InquiryList />
    </AuthGate>
  );
}
