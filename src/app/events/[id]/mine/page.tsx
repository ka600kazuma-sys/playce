import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { getMemberRegistration } from "@/lib/repo/registrations";
import { ManageView } from "@/components/ManageView";
import { memberChangeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "申込の確認・変更 | PLAYCE", robots: { index: false, follow: false } };

// ログイン中のメンバー本人の申込。どの端末でも、ログインすれば開ける。
export default async function MyRegistrationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; err?: string; done?: string; already?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const m = await requireMember(`/events/${id}/mine`);
  let r;
  try { r = await getMemberRegistration(id, m.id); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!r) return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <p>{m.nickname} さんの、このイベントへの申込は、まだありません。</p>
      <Link href={`/events/${id}/apply`} className="block rounded bg-black p-3 text-center font-semibold text-white">参加申込をする</Link>
      <Link href={`/events/${id}`} className="block text-center text-sm">← イベント詳細</Link>
    </main>
  );
  const act = (c: "cancel" | "accept" | "decline" | "edit" | "keep") => memberChangeAction.bind(null, id, c);
  return (
    <ManageView r={r} eventId={id} sp={sp} lockNickname
      banner={<>{sp.new && <p className="rounded border p-3 text-sm">申込を受け付けました。いつでも、ログインして、この画面(メニューの「自分の参加予定」)から、変更・キャンセルできます。</p>}
        {sp.already && <p className="rounded border border-amber-400 p-3 text-sm">このイベントには、すでに申込済みです。</p>}</>}
      actions={{ keep: act("keep"), accept: act("accept"), decline: act("decline"), cancel: act("cancel"), edit: act("edit") }} />
  );
}
