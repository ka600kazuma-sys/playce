import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/repo/events";
import { SPORT_LABEL } from "@/lib/domain/events";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let e;
  try {
    e = await getPublicEvent(id);
  } catch {
    return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>;
  }
  if (!e) notFound();
  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <Link href="/" className="text-sm">← カレンダーに戻る</Link>
      {e.status === "cancelled" && <p role="alert" className="rounded border p-3 font-semibold">このイベントは中止になりました。</p>}
      {e.status === "postponed" && <p role="alert" className="rounded border p-3 font-semibold">このイベントは延期になりました。</p>}
      <h1 className="text-xl font-bold">{e.title}</h1>
      {e.status === "published" && new Date(e.startAt) > new Date() && (
        <Link href={`/events/${e.id}/apply`} className="block rounded bg-black p-3 text-center font-semibold text-white">参加申込をする</Link>
      )}
      <dl className="space-y-1 text-sm">
        <div><dt className="inline font-semibold">日時: </dt><dd className="inline">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)}</dd></div>
        <div><dt className="inline font-semibold">競技: </dt><dd className="inline">{SPORT_LABEL[e.sport]}</dd></div>
        <div><dt className="inline font-semibold">場所: </dt><dd className="inline">{e.venue}</dd></div>
        <div><dt className="inline font-semibold">参加費: </dt><dd className="inline">{e.feeYen.toLocaleString()}円</dd></div>
        <div><dt className="inline font-semibold">定員: </dt><dd className="inline">{e.capacity ?? "なし"}</dd></div>
        {e.belongings && <div><dt className="inline font-semibold">持ち物: </dt><dd className="inline">{e.belongings}</dd></div>}
        {e.notes && <div><dt className="inline font-semibold">注意事項: </dt><dd className="inline">{e.notes}</dd></div>}
      </dl>
    </main>
  );
}
