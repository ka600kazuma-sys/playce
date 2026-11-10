import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { NICK_MAX } from "@/lib/domain/member";
import { logoutAction, renameAction } from "./actions";
import TransferIssuer from "./TransferIssuer";
import AvatarEditor from "./AvatarEditor";
import { listPublicEvents } from "@/lib/repo/events";
import { listMemberRegistrations } from "@/lib/repo/registrations";
import { hasAvatar } from "@/lib/repo/avatars";
import { summarize } from "@/lib/domain/mypage";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "アカウント | PLAYCE", robots: { index: false, follow: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ err?: string; done?: string }> }) {
  const m = await requireMember("/account");
  const sp = await searchParams;
  const events = await listPublicEvents().catch(() => []);
  const [regs, avatarVersion] = await Promise.all([listMemberRegistrations(m.id, events).catch(() => []), hasAvatar(m.id).catch(() => null)]);
  const sum = summarize(regs, new Date());
  const item = "grid gap-0.5 rounded-2xl border border-line p-3";
  const input = "mt-1 block w-full rounded border border-line p-3 text-base";
  return (
    <main className="mx-auto max-w-md space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">マイページ</h1>
      <div className="space-y-1">
        <AvatarEditor nickname={m.nickname} version={avatarVersion} />
        <p className="pt-1 font-serif text-lg"><strong>{m.nickname}</strong> さん</p>
      </div>
      {sp.done === "nickname" && <p className="rounded border border-line p-3 text-sm">ニックネームを変更しました。</p>}
      {sp.done === "restored" && <p className="rounded border border-line p-3 text-sm">アカウントを引き継ぎました。前の端末のログインは解除されています。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <section className="space-y-2">
        <h2 className="font-semibold">直近の参加予定</h2>
        {sum.upcomingTop.length === 0 ? <p className="text-sm text-soft">参加予定はありません。</p> : (
          <ul className="space-y-2">{sum.upcomingTop.map((r) => (
            <li key={r.event.id}><Link href={`/events/${r.event.id}/mine`} className={item}><strong className="font-serif">{r.event.title}</strong><span className="text-sm text-soft">{dateText(r.event.startAt)} {timeText(r.event.startAt)}〜</span></Link></li>
          ))}</ul>
        )}
        <Link href="/me" className="block text-right text-sm font-semibold text-blue underline">すべて見る{sum.upcoming.length > 3 ? `(${sum.upcoming.length}件)` : ""}</Link>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">累計参加回数</h2>
        <p className="rounded-2xl border border-line p-3"><span className="font-serif text-2xl font-semibold">{sum.attendedCount}</span> 回 <span className="text-xs text-soft">(当日の受付で出席確認されたイベントのみ)</span></p>
        <h3 className="pt-1 text-sm font-semibold">過去の参加履歴</h3>
        {sum.history.length === 0 ? <p className="text-sm text-soft">まだ参加履歴はありません。</p> : (
          <ul className="space-y-2">{sum.history.map((r) => (
            <li key={r.event.id} className={item}><strong className="font-serif">{r.event.title}</strong><span className="text-sm text-soft">{dateText(r.event.startAt)}</span></li>
          ))}</ul>
        )}
      </section>
      <h2 className="pt-2 font-semibold">設定</h2>
      <form action={renameAction} className="space-y-3 rounded-2xl border border-line p-4">
        <h2 className="font-semibold">ニックネームを変更</h2>
        <label className="block text-sm">新しいニックネーム(最大{NICK_MAX}文字)<input name="nickname" required maxLength={NICK_MAX} defaultValue={m.nickname} className={input} /></label>
        <p className="text-xs text-soft">参加者一覧など、表示は新しいニックネームに変わります。</p>
        <button className="w-full rounded-2xl border border-line p-3">変更する</button>
      </form>
      <TransferIssuer />
      <form action={logoutAction}><button className="w-full rounded-2xl border border-red-300 p-3 text-red-700">ログアウト</button></form>
    </main>
  );
}
