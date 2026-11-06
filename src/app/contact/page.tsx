import Link from "next/link";
import { cookies } from "next/headers";
import { listPublicEvents } from "@/lib/repo/events";
import { getThreadSummary } from "@/lib/repo/messages";
import { newFormToken } from "@/lib/repo/formtoken";
import { THREAD_STATUS_LABEL, MAX_BODY, type ThreadView } from "@/lib/domain/messages";
import { dateText, timeText } from "@/lib/format";
import { forgetMessagesAction, sendMessageAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "主催者への連絡 | PLAYCE", robots: { index: false, follow: false } };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const jar = await cookies();
  const tokens = jar.getAll().filter((c) => c.name.startsWith("msg_")).slice(0, 20).map((c) => c.value);
  const [events, mine] = await Promise.all([
    listPublicEvents().catch(() => []),
    Promise.all(tokens.map(async (t) => { try { const v = await getThreadSummary(t); return v ? { t, v } : null; } catch { return null; } })),
  ]);
  const threads = mine.filter((x): x is { t: string; v: ThreadView } => x !== null).sort((a, b) => b.v.updatedAt - a.v.updatedAt);
  const upcoming = events.filter((e) => new Date(e.startAt) > new Date());
  const formToken = newFormToken();
  return (
    <main className="mx-auto max-w-2xl space-y-4 py-4">
      <h1 className="font-serif text-xl font-medium text-navy">主催者への連絡</h1>
      <p className="text-sm text-soft">主催者にメッセージを送れます。ログインは不要です。返信は、送信後に表示される専用ページ(このブラウザの「過去のメッセージ」)で確認できます。メールなどでの通知はまだありません。</p>
      {threads.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">過去のメッセージ</h2>
          <ul className="space-y-2">{threads.map(({ t, v }) => (
            <li key={v.id}><Link href={`/contact/t/${t}`} className="grid gap-0.5 rounded-2xl border border-line p-3">
              <span className="font-semibold">{v.eventTitle ?? "（イベント指定なし）"} {v.unreadByParticipant && <span className="ml-1 rounded-full bg-[#fde7e9] px-2 py-0.5 text-xs text-[#9b1c27]">返信があります</span>}</span>
              <span className="text-sm text-soft">{dateText(new Date(v.updatedAt).toISOString())} {timeText(new Date(v.updatedAt).toISOString())} ・ {THREAD_STATUS_LABEL[v.status]}</span>
            </Link></li>))}</ul>
          <form action={forgetMessagesAction}>
            <button className="rounded border border-line px-3 py-2 text-sm text-soft">このブラウザの履歴を消す(共有の端末向け)</button>
            <p className="mt-1 text-xs text-soft">一覧を消すだけで、送ったメッセージは削除されません。専用ページのURLを控えていれば、あとで開けます。</p>
          </form>
        </section>
      )}
      <form action={sendMessageAction} className="space-y-3 rounded-2xl border border-line p-4">
        <h2 className="font-semibold">新しいメッセージ</h2>
        <input type="hidden" name="_t" value={formToken} />
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        {err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err}</p>}
        <label className="block text-sm font-semibold">ニックネーム
          <input name="nickname" required maxLength={30} className="mt-1 block w-full rounded border border-line p-3 text-base" autoComplete="off" />
        </label>
        <label className="block text-sm font-semibold">関係するイベント(任意)
          <select name="eventId" defaultValue="" className="mt-1 block w-full rounded border border-line p-3 text-base">
            <option value="">指定しない</option>
            {upcoming.map((e) => <option key={e.id} value={e.id}>{dateText(e.startAt)} {e.title}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">メッセージ(最大{MAX_BODY}文字)
          <textarea name="body" required maxLength={MAX_BODY} rows={6} className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <p className="text-xs text-soft">個人情報(電話番号・住所など)は書かないでください。</p>
        <button className="w-full rounded-2xl bg-navy-deep p-3 text-lg font-semibold tracking-widest text-white">送信する</button>
      </form>
    </main>
  );
}
