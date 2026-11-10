import { listPublicEvents } from "@/lib/repo/events";
import { listPublicParticipants } from "@/lib/repo/participants";
import type { PublicParticipants } from "@/lib/domain/participants";
import type { PublicEvent } from "@/lib/domain/events";
import { ymd } from "@/lib/format";
import { CalendarView } from "@/components/CalendarView";

export const dynamic = "force-dynamic";

async function load(): Promise<{ events: PublicEvent[]; error: boolean }> {
  try {
    return { events: await listPublicEvents(), error: false };
  } catch {
    return { events: [], error: true };
  }
}

// ホーム: 月間カレンダー(日付を選ぶとその日の開催情報と申込ボタン)。表示するのは実際に登録された公開イベントのみ。
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string; m?: string }> }) {
  const { view, m } = await searchParams;
  const now = new Date();
  const todayKey = ymd(now.toISOString());
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? "") ? (m as string) : todayKey.slice(0, 7);
  const [year, month] = ym.split("-").map(Number);
  const { events, error } = await load();
  const inMonth = events.filter((e) => ymd(e.startAt).startsWith(ym));
  // 参加表明の一覧は、公開中のイベントだけ。取得できなくても、カレンダー自体は表示する。
  const participants: Record<string, PublicParticipants> = view === "list" ? {} : await listPublicParticipants(inMonth.filter((e) => e.status === "published").map((e) => e.id)).catch(() => ({}));
  return (
    <main>
      {error && <p role="alert" className="mt-3 rounded-2xl border border-line p-3 text-sm">イベント情報を読み込めませんでした。時間をおいて再度お試しください。</p>}
      <CalendarView key={`${ym}-${view ?? "month"}`} year={year} month={month} events={inMonth} todayKey={todayKey} nowIso={now.toISOString()} view={view === "list" ? "list" : "month"} participants={participants} />
    </main>
  );
}
