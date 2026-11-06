import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyRegistration } from "@/lib/repo/registrations";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { dateText, timeText } from "@/lib/format";
import { changeAction } from "../../actions";
import { MemberFields } from "../../MemberFields";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const LABEL: Record<string, string> = {
  confirmed: "参加確定", waitlisted: "キャンセル待ち", offered: "繰上げのお知らせ（参加の意思確認中）",
  cancelled: "キャンセル済み", expired: "回答期限切れ",
};

export default async function ManagePage({ params, searchParams }: {
  params: Promise<{ id: string; token: string }>; searchParams: Promise<{ new?: string; err?: string; done?: string }>;
}) {
  const { id, token } = await params;
  const sp = await searchParams;
  if (!(await allow("manage", await requestIp()))) return <main className="mx-auto max-w-2xl p-4">短時間にアクセスが集中しています。しばらくしてからもう一度お試しください。</main>;
  let r;
  try { r = await getMyRegistration(id, token); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!r) notFound();
  const started = new Date(r.event.startAt) <= new Date();
  const live = r.status !== "cancelled" && r.status !== "expired" && !started;
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <Link href={`/events/${id}`} className="text-sm">← イベント詳細</Link>
      <h1 className="text-xl font-bold">申込の確認・変更</h1>
      {sp.new && <p className="rounded border p-3 text-sm">申込を受け付けました。<strong>このページのURLをブックマーク</strong>してください。変更・キャンセルに必要です（他の人に共有しないでください）。</p>}
      {sp.done && <p className="rounded border p-3 text-sm">変更しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <section className="space-y-1 rounded border p-3 text-sm">
        <p className="text-base font-semibold">{r.event.title}</p>
        <p>{dateText(r.event.startAt)} {timeText(r.event.startAt)}〜</p>
        <p>状態: <strong>{LABEL[r.status]}</strong></p>
        <p>代表者: {r.nickname}{r.members.length > 0 && ` / 同行者: ${r.members.join("、")}`}（{r.partySize}人）</p>
        <p>適用料金: {r.feeYen.toLocaleString()}円 / 人</p>
        {r.status === "offered" && r.offerExpiresAt && <p>回答期限: {dateText(new Date(r.offerExpiresAt).toISOString())} {timeText(new Date(r.offerExpiresAt).toISOString())}</p>}
      </section>
      {live && r.reconfirm && (
        <section className="space-y-2 rounded border border-amber-400 p-3 text-sm">
          <p className="font-semibold">開催日程が変更されました。引き続き参加しますか?</p>
          <p>申込はそのまま残っています。参加を続ける場合は「参加を継続する」を、都合が合わない場合は下の「キャンセル」を押してください。</p>
          <form action={changeAction.bind(null, id, token, "keep", undefined)}><button className="w-full rounded bg-black p-3 font-semibold text-white">参加を継続する</button></form>
        </section>
      )}
      {live && r.status === "offered" && (
        <div className="flex gap-2">
          <form action={changeAction.bind(null, id, token, "accept", undefined)} className="flex-1"><button className="w-full rounded bg-black p-3 font-semibold text-white">参加する</button></form>
          <form action={changeAction.bind(null, id, token, "decline", undefined)} className="flex-1"><button className="w-full rounded border p-3">辞退する</button></form>
        </div>
      )}
      {live && (
        <>
          <form action={changeAction.bind(null, id, token, "edit")} className="space-y-3 rounded border p-3">
            <p className="font-semibold">内容を変更する</p>
            <label className="block text-sm">ニックネーム（代表者）
              <input name="nickname" defaultValue={r.nickname} required maxLength={30} className="mt-1 block w-full rounded border p-3 text-base" />
            </label>
            <MemberFields initial={r.members} />
            <button className="w-full rounded border p-3">変更を保存</button>
          </form>
          <form action={changeAction.bind(null, id, token, "cancel", undefined)}>
            <button className="w-full rounded border border-red-500 p-3 text-red-700">申込をキャンセルする</button>
          </form>
        </>
      )}
      {started && <p className="text-sm text-gray-500">開催が始まっているため、変更・キャンセルはできません。</p>}
    </main>
  );
}
