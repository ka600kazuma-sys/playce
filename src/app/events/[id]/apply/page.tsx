import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/repo/events";
import { applyAction } from "../actions";
import { MemberFields } from "../MemberFields";
import { newFormToken } from "@/lib/repo/formtoken";
import { requireMember } from "@/lib/auth/member";
import { getMemberRegistration } from "@/lib/repo/registrations";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }>;
}) {
  const { id } = await params;
  const { err } = await searchParams;
  const member = await requireMember(`/events/${id}/apply`); // 未ログインなら、ログイン画面へ(ログイン後に、この画面へ戻る)
  let e;
  try { e = await getPublicEvent(id); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e) notFound();
  const mine = await getMemberRegistration(id, member.id).catch(() => null);
  const applied = !!mine && mine.status !== "cancelled" && mine.status !== "expired"; // すでに申込済みなら、申込ボタンは押せない
  const formToken = newFormToken();
  const open = e.status === "published" && new Date(e.startAt) > new Date();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <Link href={`/events/${id}`} className="text-sm">← イベント詳細に戻る</Link>
      <h1 className="text-xl font-bold">参加申込: {e.title}</h1>
      {!open ? <p role="alert" className="rounded border p-3">このイベントは現在、受付していません。</p> : (
        <form action={applyAction.bind(null, id)} className="space-y-4">
          <input type="hidden" name="_t" value={formToken} />
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          {err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err}</p>}
          <p className="rounded border p-3 text-sm">代表者: <strong>{member.nickname}</strong> さん(ログイン中)<br /><span className="text-xs text-gray-500">ニックネームは、メニューの「アカウント」で変更できます。</span></p>
          <MemberFields initial={[]} />
          <p className="rounded border p-3 text-sm">参加が確定すると、<strong>代表者のニックネームが、参加者一覧として、誰でも見られる場所に表示されます</strong>(同行者の名前は表示されません。人数だけが含まれます)。表示を望まない場合は、ニックネームに本名を使わないでください。</p>
          {applied
            ? <><button type="button" disabled aria-disabled="true" className="w-full cursor-not-allowed rounded bg-gray-400 p-3 font-semibold text-gray-100">{mine!.status === "confirmed" ? "申込済みです" : "キャンセル待ちで申込済みです"}</button>
                <p className="text-sm"><Link href={`/events/${id}/mine`} className="underline">申込内容を見る・変更する</Link></p></>
            : <button className="w-full rounded bg-black p-3 font-semibold text-white">申し込む</button>}
        </form>
      )}
    </main>
  );
}
