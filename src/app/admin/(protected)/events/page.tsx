import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { listAllEvents } from "@/lib/repo/adminEvents";
import { SPORT_LABEL, STATUS_LABEL, type PublicEvent } from "@/lib/domain/events";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminEvents({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireAdmin();
  const { err } = await searchParams;
  let events: PublicEvent[] = [];
  let failed = false;
  try { events = await listAllEvents(); } catch { failed = true; }
  return (
    <main className="space-y-3">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">イベント管理</h1>
        <Link href="/admin/events/new" className="rounded bg-black px-3 py-2 text-sm text-white">＋ 新規作成</Link></div>
      {(err || failed) && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err ?? "読み込めませんでした。"}</p>}
      <ul className="space-y-2">
        {events.length === 0 && !failed && <li className="text-sm text-gray-500">イベントはまだありません。</li>}
        {events.map((e) => (
          <li key={e.id}><Link href={`/admin/events/${e.id}`} className="block rounded border p-3">
            <div className="text-sm text-gray-500">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)}</div>
            <div className="font-semibold">{e.title} <span className="ml-1 rounded border px-1 text-xs font-normal">{STATUS_LABEL[e.status]}</span></div>
            <div className="text-sm">{SPORT_LABEL[e.sport]} / {e.venue} / {e.feeYen.toLocaleString()}円</div>
          </Link></li>
        ))}
      </ul>
    </main>
  );
}
