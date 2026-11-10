import Link from "next/link";
import { cookies } from "next/headers";
import { getMyRegistration, listMemberRegistrations, type MemberRegistration, type MyRegistration } from "@/lib/repo/registrations";
import { getMember } from "@/lib/auth/member";
import { listPublicEvents } from "@/lib/repo/events";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "自分の参加予定 | PLAYCE", robots: { index: false, follow: false }, referrer: "no-referrer" };

const LABEL: Record<string, string> = {
  confirmed: "参加確定", waitlisted: "キャンセル待ち", offered: "繰上げ(参加の意思確認中)", cancelled: "キャンセル済み", expired: "回答期限切れ",
};

// このブラウザで申込したときに保存された管理トークン(httpOnly Cookie reg_<イベントID>)から一覧を作る。
// 他のブラウザ・端末の申込は表示されない(ブラウザIDは本人確認ではない)。
export default async function MyRegistrationsPage() {
  const jar = await cookies();
  const pairs = jar.getAll().filter((c) => c.name.startsWith("reg_")).slice(0, 30).map((c) => ({ id: c.name.slice(4), token: c.value }));
  if (pairs.length && !(await allow("manage", await requestIp()))) return <main className="mx-auto max-w-2xl p-4">短時間にアクセスが集中しています。しばらくしてからもう一度お試しください。</main>;
  const rows = (await Promise.all(pairs.map(async (p) => {
    try { const r = await getMyRegistration(p.id, p.token); return r ? { ...p, r } : null; } catch { return null; }
  }))).filter((x): x is { id: string; token: string; r: MyRegistration } => x !== null).sort((a, b) => a.r.event.startAt.localeCompare(b.r.event.startAt));

  const member = await getMember();
  let mine: MemberRegistration[] = [];
  if (member) {
    const events = await listPublicEvents().catch(() => []);
    mine = (await listMemberRegistrations(member.id, events)).sort((a, b) => a.event.startAt.localeCompare(b.event.startAt));
  }
  // 旧(ログイン導入前)の申込は、このブラウザの専用URLの分だけ。ログイン済みの申込と重ならないものを出す。
  const legacy = rows.filter(({ id }) => !mine.some((x) => x.event.id === id));
  return (
    <main className="mx-auto max-w-2xl space-y-3 py-4">
      <h1 className="font-serif text-xl font-medium text-navy">自分の参加予定</h1>
      {member ? (
        <>
          <p className="text-sm text-soft">{member.nickname} さんの申込です(どの端末でも、ログインすれば表示されます)。</p>
          {mine.length === 0 ? <p className="text-sm text-soft">申込はまだありません。</p> : (
            <ul className="space-y-2">{mine.map((r) => (
              <li key={r.regId}>
                <Link href={`/events/${r.event.id}/mine`} className="grid gap-1 rounded-2xl border border-line p-3.5">
                  <strong className="font-serif text-lg">{r.event.title}</strong>
                  <span className="text-sm text-soft">{dateText(r.event.startAt)} {timeText(r.event.startAt)}〜</span>
                  <span className="text-sm">{r.partySize}人・{LABEL[r.status]}</span>
                </Link>
              </li>))}</ul>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-line p-3.5 text-sm">
          <p>ログインすると、どの端末でも、自分の参加予定を確認・変更できます。</p>
          <p className="mt-2 flex gap-3"><Link href="/login?next=/me" className="font-semibold text-blue underline">ログイン</Link><Link href="/signup?next=/me" className="font-semibold text-blue underline">新規登録</Link></p>
        </div>
      )}
      {legacy.length > 0 && (
        <section className="space-y-2">
          <h2 className="pt-2 text-sm font-semibold">このブラウザの、ログイン前の申込</h2>
          <ul className="space-y-2">
            {legacy.map(({ id, token, r }) => (
              <li key={id}>
                <Link href={`/events/${id}/r/${token}`} className="grid gap-1 rounded-2xl border border-line p-3.5">
                  <strong className="font-serif text-lg">{r.event.title}</strong>
                  <span className="text-sm text-soft">{dateText(r.event.startAt)} {timeText(r.event.startAt)}〜</span>
                  <span className="text-sm">{r.nickname}{r.members.length > 0 && `、${r.members.join("、")}`}({r.partySize}人)・{LABEL[r.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-soft">この一覧は、このブラウザに保存された、ログイン前の申込だけを表示します。</p>
        </section>
      )}
    </main>
  );
}
