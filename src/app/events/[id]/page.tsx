import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/repo/events";
import { listPublicParticipants } from "@/lib/repo/participants";
import { ParticipantList } from "@/components/ParticipantList";
import { SPORT_LABEL } from "@/lib/domain/events";
import { dateText, timeText } from "@/lib/format";
import { getMember } from "@/lib/auth/member";
import { ensureNumbers, getMyNumbers } from "@/lib/repo/matches";
import { getMemberRegistration } from "@/lib/repo/registrations";
import { distributeAt } from "@/lib/domain/numbers";

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
  const participants = e.status === "published" ? await listPublicParticipants([e.id]).catch(() => ({} as Record<string, never>)) : {};
  // 本人の参加番号(確定した申込がある人だけ)。開始1時間前を過ぎていれば、ここでも配布する(アクセス時の遅延実行)。
  const member = await getMember().catch(() => null);
  let myNumber: Awaited<ReturnType<typeof getMyNumbers>> | null = null;
  if (member && e.status === "published") {
    const reg = await getMemberRegistration(e.id, member.id).catch(() => null);
    if (reg?.status === "confirmed") {
      const now = new Date().getTime();
      if (now >= distributeAt(e.startAt) && now < new Date(e.endAt).getTime()) await ensureNumbers(e.id);
      myNumber = await getMyNumbers(e.id, member.id).catch(() => null);
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <Link href="/" className="text-sm">← カレンダーに戻る</Link>
      {e.status === "cancelled" && <p role="alert" className="rounded border p-3 font-semibold">このイベントは中止になりました。</p>}
      {e.status === "postponed" && <p role="alert" className="rounded border p-3 font-semibold">このイベントは延期になりました。</p>}
      <h1 className="text-xl font-bold">{e.title}</h1>
      {e.status === "published" && new Date(e.startAt) > new Date() && (
        <Link href={`/events/${e.id}/apply`} className="block rounded bg-black p-3 text-center font-semibold text-white">参加申込をする</Link>
      )}
      {myNumber && (
        <p className="rounded-2xl border border-line p-3 text-sm" data-testid="event-number">
          {myNumber.distributed && myNumber.numbers.length > 0
            ? <>あなたの参加番号: <strong className="font-serif text-2xl">{myNumber.numbers.find((n) => n.isSelf)?.number}</strong>{myNumber.numbers.filter((n) => !n.isSelf).length > 0 && <span> (同行者: {myNumber.numbers.filter((n) => !n.isSelf).map((n) => `${n.label} ${n.number}番`).join("、")})</span>}</>
            : <>参加番号: 番号配布前</>}
          {" "}<Link href={`/matches/${e.id}`} className="font-semibold text-blue underline">試合情報を見る</Link>
        </p>
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
      {e.status === "published" && <ParticipantList p={participants[e.id]} />}
    </main>
  );
}
