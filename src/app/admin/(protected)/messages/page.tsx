import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { listThreads } from "@/lib/repo/messages";
import { THREAD_STATUS_LABEL } from "@/lib/domain/messages";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Messages() {
  await requireAdmin();
  let threads;
  try { threads = await listThreads(); } catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  return (
    <main className="space-y-3">
      <Link href="/admin" className="text-sm">← 管理ホーム</Link>
      <h1 className="text-xl font-bold">参加者からのメッセージ</h1>
      {threads.length === 0 && <p className="text-sm text-gray-500">メッセージはまだありません。</p>}
      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/messages/${t.id}`} className={`block rounded border p-3 ${t.unreadByAdmin ? "border-blue-500 bg-blue-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{t.nickname}</strong>
                {t.unreadByAdmin && <span className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">未読</span>}
                <span className="rounded border px-2 py-0.5 text-xs">{THREAD_STATUS_LABEL[t.status]}</span>
              </div>
              <div className="text-sm text-gray-600">{t.eventTitle ?? "イベント指定なし"} ・ {dateText(new Date(t.updatedAt).toISOString())} {timeText(new Date(t.updatedAt).toISOString())} ・ {t.postCount}件</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
