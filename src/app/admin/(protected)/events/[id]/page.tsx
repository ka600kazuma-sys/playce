import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getEventAny, listHistory } from "@/lib/repo/adminEvents";
import { dateText, timeText } from "@/lib/format";
import { duplicateEventAction, updateEventAction } from "../actions";
import { EventForm } from "../EventForm";

export const dynamic = "force-dynamic";
const FIELD: Record<string, string> = { title: "タイトル", sport: "競技", venue: "場所", startAt: "開始", endAt: "終了", feeYen: "参加費", capacity: "定員", belongings: "持ち物", notes: "注意事項", status: "状態", seriesId: "シリーズ" };

export default async function EditEvent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; done?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  let e, history;
  try { [e, history] = await Promise.all([getEventAny(id), listHistory(id)]); }
  catch { return <main className="p-4">読み込めませんでした。</main>; }
  if (!e) notFound();
  return (
    <main className="space-y-4">
      <Link href="/admin/events" className="text-sm">← イベント一覧</Link>
      <h1 className="text-xl font-bold">イベントを編集</h1>
      {sp.done && <p className="rounded border p-3 text-sm">保存しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <Link href={`/admin/events/${id}/reception`} className="block rounded bg-black p-3 text-center font-semibold text-white">当日受付・参加者管理を開く</Link>
      <Link href={`/admin/events/${id}/accounting`} className="block rounded border p-3 text-center font-semibold">会計（売上・経費・利益）</Link>
      <Link href={`/admin/events/${id}/print`} className="block rounded border p-3 text-center font-semibold">印刷用の受付名簿</Link>
      <EventForm action={updateEventAction.bind(null, id)} event={e} />
      <form action={duplicateEventAction.bind(null, id)}><button className="w-full rounded border p-3">このイベントを複製（下書き）</button></form>
      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-semibold">変更履歴</h2>
        {history.length === 0 && <p className="text-gray-500">履歴はありません。</p>}
        <ul className="space-y-2">{history.map((h, i) => (
          <li key={i}><div className="text-gray-500">{dateText(new Date(h.at).toISOString())} {timeText(new Date(h.at).toISOString())} / {h.by}</div>
            {h.action === "create" ? "作成" : Object.entries(h.changes).map(([k, v]) => <div key={k}>{FIELD[k] ?? k}: {String(v.from ?? "なし")} → {String(v.to ?? "なし")}</div>)}
            {h.reconfirmRequested ? <div>日程変更のため、{h.reconfirmRequested}件の申込に参加継続の確認を依頼しました</div> : null}</li>
        ))}</ul>
      </section>
    </main>
  );
}
