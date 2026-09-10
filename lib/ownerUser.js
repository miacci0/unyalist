// UnyaListは実質シングルテナント(依頼者本人のみ)。inquiries/inquiry_sync_stateへの
// user_id割り当てのため、UNYALIST_OWNER_EMAIL(UnyaListにログインする個人Googleアカウントの
// メールアドレス)からSupabase AuthのuserIdを解決する。ユーザー数が少ないため、
// listUsersでページングしながら一致するメールアドレスを探す(supabase-jsにgetUserByEmail相当の
// APIが無いため)。cron実行ごとに1回呼ぶだけなので、都度検索でも問題にならない。
export async function resolveOwnerUserId(admin) {
  const email = process.env.UNYALIST_OWNER_EMAIL;
  if (!email) throw new Error("UNYALIST_OWNER_EMAIL が設定されていません");

  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = (data?.users || []).find(u => (u.email || "").toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (!data?.users || data.users.length < perPage) break;
    page += 1;
  }
  throw new Error(
    `UNYALIST_OWNER_EMAIL (${email}) に一致するSupabaseユーザーが見つかりません。先に一度UnyaListへGoogleログインしてください。`
  );
}
