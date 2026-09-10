import { createClient } from "@supabase/supabase-js";

// gmail/oauth/start・gmail/accounts系のAPIルート共通の認証ヘルパー。
// このアプリにはサーバー側セッション/クッキーが無いため、ブラウザは
// Supabaseログインセッションのaccess_tokenをAuthorization: Bearerヘッダーで送り、
// ここでSupabase Authに問い合わせてuserIdを確定する
// (animator-workspace-appのDropbox連携APIと同じ方式。あちらは各ルートに複製されているが、
// こちらはgmail関連だけで4ルートあるため共通化する)。
//
// 認証NGの場合はnullを返す(呼び出し側で401を返す)。
export async function getRequestUserId(request) {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return null;

  const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await anonClient.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user.id;
}
