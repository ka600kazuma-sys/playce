import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { getMember } from "@/lib/auth/member";
import { getPublicEvent } from "@/lib/repo/events";
import { ensureNumbers, getMyNumbers, getPublicPlan } from "@/lib/repo/matches";
import { distributeAt } from "@/lib/domain/numbers";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "試合情報 | PLAYCE", referrer: "no-referrer" };

// 試合スケジュール。参加者に見せるのは、主催者が公開した版だけ。参加者は閲覧のみ。
export default async function MatchesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const view = (await searchParams).view === "cards" ? "cards" : "table";
  const e = await getPublicEvent(id).catch(() => undefined);
  if (e === undefined) return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>;
  if (!e) notFound();
  const now = new Date().getTime();
  if (e.status === "published" && now >= distributeAt(e.startAt) && now < new Date(e.endAt).getTime()) await ensureNumbers(id); // 開始1時間前を過ぎていれば配布(アクセス時の遅延実行)
  const member = await getMember();
  const [plan, mine] = await Promise.all([getPublicPlan(id).catch(() => null), member ? getMyNumbers(id, member.id).catch(() => null) : null]);
  const mySet = new Set(mine?.numbers.map((n) => n.number) ?? []);
  const isMine = (teams: number[][]) => teams.flat().some((n) => mySet.has(n));
  const tab = (v: string, label: string) => <Link href={`/matches/${id}?view=${v}`} replace className={`rounded-full border px-3 py-1 text-sm ${view === v ? "border-navy bg-navy-deep font-semibold text-white" : "border-line"}`}>{label}</Link>;
  const teamText = (t: number[]) => t.join("・");
  return (
    <main className="mx-auto max-w-2xl space-y-3 py-4">
      <AutoRefresh seconds={15} />
      <Link href="/matches" className="text-sm">← イベント選択に戻る</Link>
      <h1 className="font-serif text-xl font-medium text-navy">{e.title}</h1>
      <p className="text-sm text-soft">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)}</p>
      {member && mine && mine.numbers.length > 0 && mine.distributed && (
        <p className="rounded-2xl border border-line bg-tint/60 p-3 text-sm" data-testid="my-number">あなたの参加番号: <strong className="font-serif text-2xl">{mine.numbers.find((n) => n.isSelf)?.number}</strong>
          {mine.numbers.filter((n) => !n.isSelf).length > 0 && <span> (同行者: {mine.numbers.filter((n) => !n.isSelf).map((n) => `${n.label} ${n.number}番`).join("、")})</span>}</p>
      )}
      {member && mine && !mine.distributed && <p className="rounded-2xl border border-line p-3 text-sm">参加番号: 番号配布前(開始1時間前に配布されます)</p>}
      {!plan ? (
        <p className="rounded-2xl border border-line p-4 text-center">試合情報はまだ公開されていません</p>
      ) : (
        <>
          <div className="flex items-center gap-2">{tab("table", "一覧表")}{tab("cards", "カード")}<span className="ml-auto text-xs text-soft">全{plan.matches.length}試合・自動更新</span></div>
          {mySet.size > 0 && <p className="text-xs text-soft"><span className="inline-block h-3 w-3 rounded-sm bg-tint align-middle" /> 色つきが、あなたの出場する試合です。</p>}
          {view === "table" ? (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[20rem] text-sm">
                <thead><tr className="border-b border-line text-left text-soft"><th className="p-2">試合</th><th className="p-2">時間帯</th><th className="p-2">コート</th><th className="p-2">組み合わせ(参加番号)</th></tr></thead>
                <tbody>{plan.matches.map((m) => (
                  <tr key={m.no} className={`border-b border-line last:border-0 ${isMine(m.teams) ? "bg-tint font-semibold" : ""}`}>
                    <td className="p-2">{m.no}</td><td className="p-2">{m.round}</td><td className="p-2">{m.court}</td>
                    <td className="p-2">{m.teams.map((t, i) => <span key={i}>{i > 0 && <span className="px-1.5 text-soft">vs</span>}{teamText(t)}</span>)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : (
            <ul className="grid gap-2">{plan.matches.map((m) => (
              <li key={m.no} className={`rounded-2xl border border-line p-3 ${isMine(m.teams) ? "bg-tint" : ""}`}>
                <div className="flex justify-between text-sm text-soft"><strong className="text-ink">試合{m.no}</strong><span>時間帯{m.round} ・ コート{m.court}</span></div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-serif text-lg">{m.teams.map((t, i) => <span key={i}>{i > 0 && <span className="px-1 text-sm text-soft">vs</span>}{teamText(t)}</span>)}</div>
              </li>))}</ul>
          )}
        </>
      )}
    </main>
  );
}
