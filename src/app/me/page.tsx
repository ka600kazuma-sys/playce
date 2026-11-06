import Link from "next/link";
import { cookies } from "next/headers";
import { getMyRegistration, type MyRegistration } from "@/lib/repo/registrations";
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

  return (
    <main className="mx-auto max-w-2xl space-y-3 py-4">
      <h1 className="font-serif text-xl font-medium text-navy">自分の参加予定</h1>
      {rows.length === 0 ? <p className="text-sm text-soft">このブラウザには申込がありません。申込後に表示される専用URLからも確認できます。</p> : (
        <ul className="space-y-2">
          {rows.map(({ id, token, r }) => (
            <li key={id}>
              <Link href={`/events/${id}/r/${token}`} className="grid gap-1 rounded-2xl border border-line p-3.5">
                <strong className="font-serif text-lg">{r.event.title}</strong>
                <span className="text-sm text-soft">{dateText(r.event.startAt)} {timeText(r.event.startAt)}〜</span>
                <span className="text-sm">{r.nickname}{r.members.length > 0 && `、${r.members.join("、")}`}({r.partySize}人)・{LABEL[r.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-soft">この一覧は、このブラウザに保存された申込だけを表示します。</p>
    </main>
  );
}
