"use client";
import { useRouter } from "next/navigation";
export function LogoutButton() {
  const router = useRouter();
  return (
    <button className="rounded border px-3 py-1" onClick={async () => {
      await fetch("/api/auth/session", { method: "DELETE" });
      router.replace("/admin/login"); router.refresh();
    }}>ログアウト</button>
  );
}
