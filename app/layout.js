import "./globals.css";

export const metadata = {
  title: "UnyaList",
  description: "仕事依頼メールの未確定案件を一覧管理するツール",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
