import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getDeletionInfo, getEventAny } from "@/lib/repo/adminEvents";
import { deletionBlock, STATUS_LABEL } from "@/lib/domain/events";
import { dateText, timeText } from "@/lib/format";
import { deleteEventAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DeleteEvent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { err } = await searchParams;
  let e, info;
  try { [e, info] = await Promise.all([getEventAny(id), getDeletionInfo(id)]); } catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e || !info) notFound();
  const block = deletionBlock(info);
  return (
    <main className="space-y-3">
      <Link href="/admin/events" className="text-sm">← イベント一覧</Link>
      <h1 className="text-xl font-bold">イベントを削除</h1>
      {err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err}</p>}
      <section className="rounded border p-3 text-sm">
        <p className="text-base font-semibold">{e.title} <span className="rounded border px-1 text-xs font-normal">{STATUS_LABEL[e.status]}</span></p>
        <p>{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)} / {e.venue}</p>
        <p className="mt-2">申込: {info.registrations}件(うち受付中・待ち {info.activeRegistrations}件)/ 入金記録: {info.payments}件 / 経費記録: {info.expenses}件</p>
      </section>
      {block ? (
        <>
          <p role="alert" className="rounded border border-red-400 p-3 text-sm">{block}</p>
          <Link href={`/admin/events/${id}`} className="block rounded border p-3 text-center">イベントの編集に戻る(公開状態を変えられます)</Link>
        </>
      ) : (
        <form action={deleteEventAction.bind(null, id)} className="space-y-3">
          <div className="rounded border border-red-400 p-3 text-sm">
            <p className="font-semibold text-red-700">この操作は元に戻せません。</p>
            <ul className="mt-1 list-disc pl-5">
              <li>イベントと、申込({info.registrations}件)・変更履歴が、すべて削除されます。</li>
              {info.activeRegistrations > 0 && <li><strong>参加者が、申込のページを開けなくなります。</strong>先に公開状態を「中止」にして、お知らせすることをおすすめします。</li>}
              <li>公開カレンダーからも、すぐに消えます。</li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1 h-5 w-5" /> 元に戻せないことを理解しました</label>
          <button className="w-full rounded bg-red-700 p-3 font-semibold text-white">このイベントを削除する</button>
          <Link href={`/admin/events/${id}`} className="block rounded border p-3 text-center">やめる</Link>
        </form>
      )}
    </main>
  );
}
