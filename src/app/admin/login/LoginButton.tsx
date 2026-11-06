"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";

export function LoginButton() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function login() {
    setBusy(true); setMsg("");
    try {
      const auth = clientAuth();
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const res = await fetch("/api/auth/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await cred.user.getIdToken() }),
      });
      await signOut(auth); // ブラウザ側の Firebase セッションは残さない(サーバーのCookieのみ使う)
      if (res.ok) { router.replace("/admin"); router.refresh(); return; }
      setMsg("このアカウントでは管理画面を利用できません。");
    } catch {
      setMsg("ログインできませんでした。もう一度お試しください。");
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <button onClick={login} disabled={busy} className="w-full rounded bg-black p-3 font-semibold text-white disabled:opacity-50">Googleでログイン</button>
      {msg && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{msg}</p>}
    </div>
  );
}
