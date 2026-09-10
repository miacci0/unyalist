import { createClient } from "@supabase/supabase-js";

// service role(RLSを無視できる)クライアント。cronの受信メール取り込みなど、サーバー側専用の
// 処理でのみ使う(ブラウザ側コードから絶対にimportしないこと)。
//
// 【重要】fetchにcache:"no-store"を明示しないと、Next.jsのfetchキャッシュにより
// force-dynamicでもservice-role経由の読み取りが古いデータを返すことがある
// (Animator Workspace側で踏んだ既知の罠と同じ)。
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません(.env.localを確認してください)");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
}
