import Link from "next/link";
import { listPublicEvents } from "@/lib/repo/events";
import { dateText, timeText } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "試合情報 | PLAYCE" };

// 試合情報: イベントを選ぶ(過去・当日・今後のすべて)。
export default async function MatchesIndex() {
  const events = await listPublicEvents().catch(() => null);
  if (!events) return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>;
  const now = new Date().getTime();
  const coming = events.filter((e) => new Date(e.endAt).getTime() >= now);
  const past = events.filter((e) => new Date(e.endAt).getTime() < now).reverse();
  const row = (e: (typeof events)[number], tag: string) => (
    <li key={e.id}>
      <Link href={`/matches/${e.id}`} className="grid gap-0.5 rounded-2xl border border-line p-3.5">
        <strong className="font-serif text-lg">{e.title}</strong>
        <span className="text-sm text-soft">{dateText(e.startAt)} {timeText(e.startAt)}〜 {tag}</span>
      </Link>
    </li>
  );
  return (
    <main className="mx-auto max-w-2xl space-y-3 py-4">
      <h1 className="font-serif text-xl font-medium text-navy">試合情報</h1>
      <p className="text-sm text-soft">イベントを選ぶと、主催者が公開した試合の組み合わせを見られます。</p>
      <h2 className="text-sm font-semibold">当日・今後のイベント</h2>
      {coming.length === 0 ? <p className="text-sm text-soft">ありません。</p> : <ul className="space-y-2">{coming.map((e) => row(e, new Date(e.startAt).getTime() <= now ? "(開催中)" : ""))}</ul>}
      <h2 className="pt-2 text-sm font-semibold">過去のイベント</h2>
      {past.length === 0 ? <p className="text-sm text-soft">ありません。</p> : <ul className="space-y-2">{past.map((e) => row(e, ""))}</ul>}
    </main>
  );
}
