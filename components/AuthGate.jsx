"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// 独立アプリ版のログインゲート(routine-appのAuthGateを踏襲)。Googleログインのみのシンプルな構成。
// redirectToはこのアプリ自身のorigin(window.location.origin)を指定するため、
// ログイン後は他の姉妹アプリ(Animator Workspace / routine-app)ではなくこのアプリに戻ってくる。
//
// 【重要】OAuthのリダイレクト先はSupabaseプロジェクト側の許可リストで管理されている。
// このアプリを別ドメイン/ポートで動かす場合、Supabaseダッシュボードの
// Authentication > URL Configuration > Redirect URLs に、このアプリのURL
// (例: http://localhost:3004 や本番ドメイン)を追加登録する必要がある。
//
// inquiries / inquiry_sync_stateはuser_idでRLS分離されているため、ここでログインした
// アカウント(=UNYALIST_OWNER_EMAILと一致させる想定)以外は自分の行を一切見られない。

export default function AuthGate({ children }) {
  // undefined = 読み込み中 / null = 未ログイン / セッションあり = ログイン済み
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (session === undefined) {
    return (
      <div className="auth-gate-loading">
        <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
        読み込み中…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-gate-login">
        <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
        <div className="auth-card">
          <div className="auth-mark">📬</div>
          <h1>UnyaList</h1>
          <p>Googleアカウントでログインしてください</p>
          <button onClick={signIn}>Googleでログイン</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-gate-shell">
      <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
      <div className="auth-topbar">
        <span className="auth-topbar-title">UnyaList</span>
        <span>{session.user.email}</span>
        <button onClick={signOut}>ログアウト</button>
      </div>
      {children}
    </div>
  );
}

const AUTH_CSS = `
.auth-gate-loading, .auth-gate-login, .auth-gate-shell {
  min-height: 100dvh;
  background: #F7F5F0;
  color: #211F1A;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Zen Kaku Gothic New', sans-serif;
}
.auth-gate-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  color: #837E71;
}
.auth-gate-login {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.auth-card {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.auth-mark { font-size: 34px; }
.auth-card h1 {
  font-weight: 700;
  font-size: 22px;
  margin: 0;
  letter-spacing: 0.02em;
}
.auth-card p {
  margin: 0;
  font-size: 13px;
  color: #837E71;
}
.auth-card button {
  margin-top: 6px;
  background: #4C6C57;
  color: #FBFAF6;
  border: none;
  border-radius: 8px;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.auth-card button:hover { opacity: 0.9; }
.auth-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-bottom: 1px solid #E4E0D6;
  font-size: 12px;
  color: #837E71;
}
.auth-topbar-title {
  font-weight: 700;
  font-size: 14px;
  color: #211F1A;
  margin-right: auto;
}
.auth-topbar button {
  background: transparent;
  border: none;
  color: #837E71;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  font-family: inherit;
}
.auth-topbar button:hover { color: #211F1A; }
`;
