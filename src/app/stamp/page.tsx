import Link from "next/link";
import { getMember } from "@/lib/auth/member";
import { getTickets } from "@/lib/repo/stamps";
import { buildTicketModel, TAP_NOTICE } from "@/lib/domain/stampticket";
import { isStampSport } from "@/lib/domain/stamps";
import { venueLinks } from "@/lib/repo/venues";
import StampTickets from "./StampTickets";

export const dynamic = "force-dynamic";
export const metadata = { title: "スタンプカード | PLAYCE", robots: { index: false, follow: false } };

// メニューの「スタンプカード」。チケットだけを全画面に出す。タグをかざすと、この画面が開いてスタンプが反映される。
// ?tap=...&sport=... は、かざした結果の「案内」と「ハンコの演出」にだけ使う。ポイントやハンコの有無は、必ずDBの値で決める。
export default async function StampPage({ searchParams }: { searchParams: Promise<{ tap?: string; sport?: string; n?: string }> }) {
  const member = await getMember();
  if (!member) {
    return (
      <main className="mx-auto max-w-md space-y-4 py-8 text-center">
        <h1 className="font-serif text-xl font-medium text-navy">スタンプカード</h1>
        <p className="text-sm text-soft">スタンプカードを使うには、ログインが必要です。ふだんは自動でログインします。</p>
        <Link href="/login?next=%2Fstamp" className="block rounded-2xl bg-navy-deep p-3 font-semibold text-white">ログイン / 新規登録</Link>
      </main>
    );
  }
  const sp = await searchParams;
  const tickets = await getTickets(member.id).catch(() => null);
  if (!tickets) return <main className="p-4 text-center text-sm">読み込めませんでした。時間をおいて、もう一度お試しください。</main>;
  const sport = isStampSport(sp.sport) ? sp.sport : null;
  const tapKey = typeof sp.tap === "string" && (sp.tap === "ok" || Object.hasOwn(TAP_NOTICE, sp.tap)) ? sp.tap : null;
  const links = await venueLinks(tickets.flatMap((t) => (t.event ? [t.event.venue] : [])));
  const models = tickets.map((t) => {
    // 「押された」演出は、DBに記録があるときだけ(アドレスを書き換えても、押されたことにはならない)。
    const newIndex = tapKey === "ok" && t.sport === sport && t.tapped ? t.points : 0;
    return buildTicketModel(t, member.nickname, newIndex, t.event ? (links[t.event.venue] ?? null) : null);
  });
  const animateSport = tapKey === "ok" && sport && models.some((m) => m.sport === sport && m.tapped) ? sport : null;
  // 付け忘れの後づけ・QRで付いたスタンプは、チケットのイベントとは別の回に付くため、ハンコの演出の代わりに案内を出す(個数は表示用)。
  const n = sp.n === "2" ? 2 : 1;
  const notice = tapKey && tapKey !== "ok" ? { sport, text: TAP_NOTICE[tapKey] } : tapKey === "ok" && !animateSport ? { sport, text: `スタンプを${n}個、付けました` } : null;
  return <StampTickets models={models} initialSport={sport ?? models[0]?.sport ?? "badminton"} notice={notice} animateSport={animateSport} />;
}
