import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/apiAuth";
import { signOAuthState } from "@/lib/gmailAccountAuth";
import { getRequestOrigin } from "@/lib/requestOrigin";

// 「Gmailアカウントを追加」ボタンから呼ばれる。Googleの同意画面URLを組み立てて返す。
// 呼び出し元(ブラウザ)はwindow.location.href = urlでフルナビゲーションする
// (fetchでは完結しない、Googleの同意画面に実際に遷移する必要があるため)。
export async function POST(request) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID が設定されていません" }, { status: 500 });
  }

  let state;
  try {
    state = signOAuthState(userId);
  } catch (err) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }

  const redirectUri = `${getRequestOrigin(request)}/api/gmail/oauth/callback`;
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("access_type", "offline");
  // 複数アカウントを追加する際、毎回確実にrefresh tokenを再発行させるためprompt=consentを固定する
  // (省略すると2回目以降の同意でrefresh tokenが返らないことがある)。
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.json({ url: authorizeUrl.toString() });
}
