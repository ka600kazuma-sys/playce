import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { unreadCount } from "@/lib/repo/messages";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  await requireAdmin(); // ページ単位でも検証する(レイアウトだけに頼らない)
  const unread = await unreadCount().catch(() => 0);
  return (
    <main>
      <h1 className="text-xl font-bold">管理ホーム</h1>
      <ul className="mt-3 space-y-2">
        <li><Link href="/admin/events/new" className="block rounded bg-blue-700 p-3 text-center font-semibold text-white">＋ 新規作成</Link></li>
        <li><Link href="/admin/events" className="block rounded border p-3 font-semibold">イベント一覧</Link></li>
        <li><Link href="/admin/members" className="block rounded border p-3 font-semibold">メンバー(参加者アカウント)の管理</Link></li>
        <li><Link href="/admin/messages" className="block rounded border p-3 font-semibold">参加者からのメッセージ{unread > 0 && <span className="ml-2 rounded bg-blue-600 px-2 py-0.5 text-xs text-white">未読 {unread}</span>}</Link></li>
        <li><Link href="/" className="block rounded border p-3 font-semibold">公開カレンダーを見る</Link></li>
      </ul>
      <p className="mt-3 text-sm text-gray-600">参加者管理・受付・会計は、イベントの編集画面から開けます。</p>
    </main>
  );
}
