import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { unreadCount } from "@/lib/repo/messages";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "PLAYCE 管理", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const unread = await unreadCount().catch(() => 0); // 取得できなくても管理画面は使えるようにする
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 space-y-2 text-sm print:hidden">
        <div className="flex items-center justify-between">
          <Link href="/admin" className="font-semibold">PLAYCE 管理</Link>
          <span className="flex items-center gap-3"><span>{admin.email}</span><LogoutButton /></span>
        </div>
        <nav aria-label="管理メニュー" className="flex flex-wrap gap-2">
          <Link href="/" className="rounded border px-3 py-1.5 font-semibold">← カレンダーを見る</Link>
          <Link href="/admin/events" className="rounded border px-3 py-1.5 font-semibold">イベント一覧</Link>
          <Link href="/admin/events/new" className="rounded bg-blue-700 px-3 py-1.5 font-semibold text-white">＋ 新規作成</Link>
          <Link href="/admin/members" className="rounded border px-3 py-1.5">メンバー</Link>
          <Link href="/admin/messages" className="rounded border px-3 py-1.5">メッセージ{unread > 0 && <span className="ml-1 rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">{unread}</span>}</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
