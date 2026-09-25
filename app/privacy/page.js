// 公開プライバシーポリシー(認証なしで誰でも閲覧できる)。app/page.jsだけがAuthGateで
// ログインを要求しているため、このルートは未ログインでも表示される。
// Google Cloud ConsoleのOAuth同意画面(アプリを公開)に、このページのURLを設定する。
// 記載内容はコードの実挙動(lib/gmail.js, lib/gmailSync.js, lib/gemini.js,
// supabase/*.sql)に合わせてある。挙動を変えたら、ここも更新すること。

export const metadata = {
  title: "プライバシーポリシー | UnyaList",
  description: "UnyaListのプライバシーポリシー",
};

const OPERATOR = "みやち";
const CONTACT_EMAIL = "luce.eterne@gmail.com";
const EFFECTIVE_DATE = "2026年9月25日";

export default function PrivacyPage() {
  return (
    <main className="privacy">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <a className="back" href="/">← UnyaListに戻る</a>
      <h1>プライバシーポリシー</h1>
      <p className="meta">施行日: {EFFECTIVE_DATE} / 運営者: {OPERATOR}</p>

      <p>
        UnyaList(以下「本サービス」)は、運営者({OPERATOR})が自身の仕事依頼メールを管理するために運営する個人向けのツールです。本ポリシーは、本サービスがどのような情報を取得・保存・利用するかを説明します。
      </p>

      <h2>1. 取得する情報</h2>
      <ul>
        <li>
          <b>Googleアカウントでのログイン情報</b>: 本サービスへのログインにはGoogleアカウントを使用します。ログイン時に、メールアドレスと氏名などの基本プロフィールを認証基盤(Supabase Auth)が受け取ります。
        </li>
        <li>
          <b>Gmailの内容(読み取り専用)</b>: 利用者が連携を許可したGmailアカウントについて、読み取り専用の権限(<code>https://www.googleapis.com/auth/gmail.readonly</code>)でメールを参照します。対象は受信したメールのみで、送信済みメール・迷惑メール・ゴミ箱・チャットは対象外です。添付ファイルは取得しません。本サービスからメールを送信・削除・変更することはできません。
        </li>
      </ul>

      <h2>2. 保存する情報</h2>
      <p>仕事依頼の管理に必要な範囲で、次の情報をデータベース(Supabase)に保存します。</p>
      <ul>
        <li>送信者の名前とメールアドレス、件名、受信日時</li>
        <li>AIが生成した要約、および抽出した案件名・希望納期・単価などの情報</li>
        <li>メール本文の<b>先頭1,000文字の抜粋</b>(本文の全文は保存しません)</li>
        <li>GmailのメッセージIDとスレッドID、連携したGmailアカウントのメールアドレスと表示名</li>
        <li>Gmailへアクセスするための認可トークン(refresh token)。AES-256-GCMで暗号化して保存します</li>
        <li>案件のステータス(未確認・検討中など、利用者が操作した状態)</li>
      </ul>

      <h2>3. 利用目的</h2>
      <p>
        取得した情報は、仕事依頼メールの検出・分類・要約・スレッド整理と、利用者本人への一覧表示のためだけに利用します。広告への利用、第三者への販売・提供は行いません。取得したデータを人間が閲覧するのは、利用者本人の同意がある場合、セキュリティ上の調査が必要な場合、または法令上必要な場合に限ります。
      </p>
      <p className="quote">
        UnyaList&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>4. 外部サービスへの提供・委託</h2>
      <p>本サービスは次の外部サービスを利用しており、それぞれの目的の範囲でのみデータが渡ります。</p>
      <ul>
        <li>
          <b>Google Gemini API</b>: メールが仕事依頼かどうかの判定と要約のため、メールの件名・送信者・本文の先頭6,000文字を送信します。送信された内容はGeminiの利用規約に従って処理され、利用中のプランによっては、Googleがサービス改善のために利用する場合があります。
        </li>
        <li><b>Supabase</b>: データベースとログイン認証の基盤として、上記の保存情報を保管します。</li>
        <li><b>Vercel</b>: 本サービスのホスティングに利用します。</li>
        <li><b>GitHub Actions</b>: 同期処理を定期的に起動するためだけに利用します(メールの内容は扱いません)。</li>
      </ul>
      <p>これらの事業者のサーバーは日本国外にある場合があります。</p>

      <h2>5. 保持期間と削除</h2>
      <ul>
        <li>
          本サービス上でGmailアカウントの連携を「解除」すると、保存していた認可トークンを削除し、以後そのアカウントのメールには一切アクセスしません。解除前に取り込んだ案件データは残ります。
        </li>
        <li>
          取り込み済みの案件データや、ログインアカウントに関する情報の削除をご希望の場合は、下記の連絡先までご連絡ください。合理的な期間内に削除します。
        </li>
        <li>
          Googleアカウントの
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            「サードパーティのアプリとサービス」
          </a>
          の画面から、いつでも本サービスへのアクセス許可を取り消せます。
        </li>
      </ul>

      <h2>6. Cookie・アクセス解析</h2>
      <p>
        広告配信やアクセス解析のためのツールは使用していません。ログイン状態を維持するために、認証基盤(Supabase Auth)がブラウザにセッション情報を保存します。
      </p>

      <h2>7. 安全管理</h2>
      <p>
        通信はHTTPSで保護し、Gmailへの認可トークンは暗号化して保存します。データベースは行レベルのアクセス制御により、ログインした本人のデータのみが参照できるようにしています。ただし、インターネット上のサービスとして完全な安全性を保証するものではありません。
      </p>

      <h2>8. 本ポリシーの変更</h2>
      <p>
        本サービスの機能や外部サービスの変更に伴い、本ポリシーを改定することがあります。重要な変更は本ページで告知します。
      </p>

      <h2>9. お問い合わせ</h2>
      <p>
        運営者: {OPERATOR}
        <br />
        連絡先: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}

const CSS = `
.privacy {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 20px 64px;
  background: #F7F5F0;
  color: #211F1A;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Zen Kaku Gothic New', sans-serif;
  font-size: 14px;
  line-height: 1.85;
  min-height: 100dvh;
}
.privacy h1 { font-size: 22px; margin: 18px 0 4px; }
.privacy h2 { font-size: 16px; margin: 28px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #E4E0D6; }
.privacy .meta { color: #837E71; font-size: 12.5px; margin: 0 0 18px; }
.privacy .back { font-size: 12.5px; color: #4C6C57; text-decoration: none; }
.privacy .back:hover { text-decoration: underline; }
.privacy a { color: #2F5D46; }
.privacy ul { padding-left: 1.3em; }
.privacy li { margin: 4px 0; }
.privacy code { background: #EFECE3; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; word-break: break-all; }
.privacy .quote { background: #EFECE3; border-left: 3px solid #4C6C57; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
`;
