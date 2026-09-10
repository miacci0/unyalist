import { createClient } from "@supabase/supabase-js";

// Animator Workspace / routine-appと同じSupabaseプロジェクト(同じGoogleログインユーザー)を使う。
// テーブルはこのアプリ専用(inquiries / inquiry_sync_state)なので、コード・デプロイは完全に独立している。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
