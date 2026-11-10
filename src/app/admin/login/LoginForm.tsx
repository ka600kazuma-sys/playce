"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) { router.replace("/admin"); router.refresh(); return; }
      const j = await res.json().catch(() => ({}));
      setMsg(typeof j.error === "string" && res.status !== 403 ? j.error : "ログインできませんでした。もう一度お試しください。");
    } catch {
      setMsg("通信できませんでした。もう一度お試しください。");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold">パスワード
        <input type="password" name="password" required autoComplete="current-password" maxLength={400} className="mt-1 block w-full rounded border p-3 text-base" />
      </label>
      <button disabled={busy} className="w-full rounded bg-black p-3 font-semibold text-white disabled:opacity-50">ログイン</button>
      {msg && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{msg}</p>}
    </form>
  );
}
