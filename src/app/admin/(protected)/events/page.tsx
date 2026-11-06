import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { listAllEvents } from "@/lib/repo/adminEvents";
import { SPORT_LABEL, STATUS_LABEL, type PublicEvent } from "@/lib/domain/events";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminEvents({ searchParams }: { searchParams: Promise<{ err?: string; deleted?: string }> }) {
  await requireAdmin();
  const { err, deleted } = await searchParams;
  let events: PublicEvent[] = [];
  let failed = false;
  try { events = await listAllEvents(); } catch { failed = true; }
  return (
    <main className="space-y-3">
      <h1 className="text-xl font-bold">イベント一覧</h1>
      <Link href="/admin/events/new" className="block rounded bg-blue-700 p-4 text-center text-lg font-semibold text-white">＋ 新規作成</Link>
      {deleted && <p className="rounded border p-3 text-sm">イベントを削除しました。</p>}
      {(err || failed) && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err ?? "読み込めませんでした。"}</p>}
      <ul className="space-y-2">
        {events.length === 0 && !failed && <li className="text-sm text-gray-500">イベントはまだありません。</li>}
        {events.map((e) => (
          <li key={e.id} className="flex items-stretch gap-2">
            <Link href={`/admin/events/${e.id}`} className="block flex-1 rounded border p-3">
              <div className="text-sm text-gray-500">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)}</div>
              <div className="font-semibold">{e.title} <span className={`ml-1 rounded border px-1 text-xs font-normal ${e.status === "published" ? "border-green-600 text-green-700" : ""}`}>{STATUS_LABEL[e.status]}</span></div>
              <div className="text-sm">{SPORT_LABEL[e.sport]} / {e.venue} / {e.feeYen.toLocaleString()}円</div>
            </Link>
            <Link href={`/admin/events/${e.id}/delete`} aria-label={`${e.title}を削除`} className="grid w-16 place-items-center rounded border border-red-300 text-sm text-red-700">削除</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
