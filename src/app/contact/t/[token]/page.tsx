import Link from "next/link";
import { notFound } from "next/navigation";
import { getThreadByToken } from "@/lib/repo/messages";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { newFormToken } from "@/lib/repo/formtoken";
import { THREAD_STATUS_LABEL, MAX_BODY } from "@/lib/domain/messages";
import { dateText, timeText } from "@/lib/format";
import { replyAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "メッセージ | PLAYCE", robots: { index: false, follow: false }, referrer: "no-referrer" };

// 参加者専用のスレッド(専用URL)。URLを知っている人だけが読める。他の人に共有しないこと。
export default async function ThreadPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string; sent?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!(await allow("manage", await requestIp()))) return <main className="mx-auto max-w-2xl p-4">短時間にアクセスが集中しています。しばらくしてからもう一度お試しください。</main>;
  let data;
  try { data = await getThreadByToken(token); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!data) notFound();
  const { thread, posts } = data;
  const formToken = newFormToken();
  const stamp = (n: number) => `${dateText(new Date(n).toISOString())} ${timeText(new Date(n).toISOString())}`;
  return (
    <main className="mx-auto max-w-2xl space-y-4 py-4">
      <Link href="/contact" className="text-sm">← 主催者への連絡</Link>
      <h1 className="font-serif text-xl font-medium text-navy">{thread.eventTitle ?? "メッセージ"}</h1>
      <p className="text-sm text-soft">{thread.nickname} さん ・ 状態: <strong>{THREAD_STATUS_LABEL[thread.status]}</strong></p>
      {sp.new && <p className="rounded border border-line p-3 text-sm">送信しました。<strong>このページのURLをブックマーク</strong>してください。返信はここに表示されます(通知はありません)。他の人に共有しないでください。</p>}
      {sp.sent && <p className="rounded border border-line p-3 text-sm">送信しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <ul className="space-y-2">
        {posts.map((p) => (
          <li key={p.id} className={`rounded-2xl border p-3 ${p.from === "organizer" ? "border-blue bg-tint" : "border-line"}`}>
            <div className="text-xs text-soft">{p.from === "organizer" ? "主催者" : "あなた"} ・ {stamp(p.at)}</div>
            <p className="mt-1 whitespace-pre-wrap break-words">{p.body}</p>
          </li>
        ))}
      </ul>
      <form action={replyAction.bind(null, token)} className="space-y-2 rounded-2xl border border-line p-3">
        <input type="hidden" name="_t" value={formToken} />
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="block text-sm font-semibold">返信する
          <textarea name="body" required maxLength={MAX_BODY} rows={4} className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <button className="w-full rounded-2xl bg-navy-deep p-3 font-semibold text-white">送信する</button>
      </form>
    </main>
  );
}
