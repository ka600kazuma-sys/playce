import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/repo/events";
import { applyAction } from "../actions";
import { MemberFields } from "../MemberFields";
import { newFormToken } from "@/lib/repo/formtoken";

export const dynamic = "force-dynamic";

// 重要ルールの文面は主催者が決定する。確定するまで仮の文面を表示する。
const RULES = "（仮）参加に関する重要ルールは、主催者が確定次第ここに表示します。";

export default async function ApplyPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; dup?: string }>;
}) {
  const { id } = await params;
  const { err, dup } = await searchParams;
  let e;
  try { e = await getPublicEvent(id); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e) notFound();
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
          {dup && (
            <div role="alert" className="rounded border border-yellow-500 p-3 text-sm">
              <p>このブラウザから、すでにこのイベントへ申込があります。別の人の申込であればチェックして進めてください。</p>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="confirmDuplicate" /> 別の申込として続ける</label>
            </div>
          )}
          <label className="block text-sm font-semibold">ニックネーム（代表者）
            <input name="nickname" required maxLength={30} className="mt-1 block w-full rounded border p-3 text-base" autoComplete="off" />
          </label>
          <MemberFields initial={[]} />
          <div className="rounded border p-3 text-sm">
            <p className="font-semibold">重要ルール</p>
            <p className="my-2">{RULES}</p>
            <label className="flex items-center gap-2"><input type="checkbox" name="agreedRules" required /> 内容に同意します</label>
          </div>
          <p className="rounded border p-3 text-sm">参加が確定すると、<strong>代表者のニックネームが、参加者一覧として、誰でも見られる場所に表示されます</strong>(同行者の名前は表示されません。人数だけが含まれます)。表示を望まない場合は、ニックネームに本名を使わないでください。</p>
          <button className="w-full rounded bg-black p-3 font-semibold text-white">申し込む</button>
          <p className="text-xs text-gray-500">申込後に表示される専用URLは、変更・キャンセルに必要です。他の人に共有しないでください。</p>
        </form>
      )}
    </main>
  );
}
