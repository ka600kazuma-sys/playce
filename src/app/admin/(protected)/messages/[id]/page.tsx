import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { openThreadAsAdmin } from "@/lib/repo/messages";
import { THREAD_STATUS, THREAD_STATUS_LABEL, MAX_BODY } from "@/lib/domain/messages";
import { dateText, timeText } from "@/lib/format";
import { replyAsOrganizerAction, setStatusAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function MessageThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; done?: string; err?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  let data;
  try { data = await openThreadAsAdmin(id); } catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!data) notFound();
  const { thread, posts } = data;
  const stamp = (n: number) => `${dateText(new Date(n).toISOString())} ${timeText(new Date(n).toISOString())}`;
  return (
    <main className="space-y-3">
      <Link href="/admin/messages" className="text-sm">← メッセージ一覧</Link>
      <h1 className="text-xl font-bold">{thread.nickname} さん</h1>
      <p className="text-sm text-gray-600">{thread.eventTitle ?? "イベント指定なし"} ・ 状態: <strong>{THREAD_STATUS_LABEL[thread.status]}</strong>(返信しても参加者には通知されません。参加者がスレッドのページを開くと表示されます)</p>
      {sp.sent && <p className="rounded border p-3 text-sm">返信しました。</p>}
      {sp.done && <p className="rounded border p-3 text-sm">状態を変更しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <ul className="space-y-2">
        {posts.map((p) => (
          <li key={p.id} className={`rounded border p-3 ${p.from === "organizer" ? "bg-blue-50" : ""}`}>
            <div className="text-xs text-gray-500">{p.from === "organizer" ? "主催者(あなた)" : thread.nickname} ・ {stamp(p.at)}</div>
            <p className="mt-1 whitespace-pre-wrap break-words">{p.body}</p>
          </li>
        ))}
      </ul>
      <form action={replyAsOrganizerAction.bind(null, id)} className="space-y-2 rounded border p-3">
        <label className="block text-sm font-semibold">返信
          <textarea name="body" required maxLength={MAX_BODY} rows={4} className="mt-1 block w-full rounded border p-3 text-base" />
        </label>
        <button className="w-full rounded bg-black p-3 font-semibold text-white">返信する</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {THREAD_STATUS.filter((s) => s !== thread.status).map((s) => (
          <form key={s} action={setStatusAction.bind(null, id, s)}><button className="rounded border px-3 py-2 text-sm">「{THREAD_STATUS_LABEL[s]}」にする</button></form>
        ))}
      </div>
    </main>
  );
}
