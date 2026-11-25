import { listPublicEvents } from "@/lib/repo/events";
import { listPublicParticipants } from "@/lib/repo/participants";
import type { PublicParticipants } from "@/lib/domain/participants";
import type { PublicEvent } from "@/lib/domain/events";
import { ymd } from "@/lib/format";
import { Suspense } from "react";
import { CalendarView } from "@/components/CalendarView";
import { venueLinks } from "@/lib/repo/venues";
import { getMemberForRender } from "@/lib/auth/member";
import { listMemberRegistrations } from "@/lib/repo/registrations";

export const dynamic = "force-dynamic";

async function load(): Promise<{ events: PublicEvent[]; error: boolean }> {
  try {
    return { events: await listPublicEvents(), error: false };
  } catch {
    return { events: [], error: true };
  }
}

// ホーム: 月間カレンダー(日付を選ぶとその日の開催情報と申込ボタン)。表示するのは実際に登録された公開イベントのみ。
// 読み込み中の骨組みは、このページだけに付ける(全ページに付けると、未ログイン時のリダイレクトが後出しになり、管理画面の保護の挙動が変わるため)。
export default function Home({ searchParams }: { searchParams: Promise<{ view?: string; m?: string }> }) {
  return <Suspense fallback={<Skeleton />}><HomeContent searchParams={searchParams} /></Suspense>;
}

function Skeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mt-4 space-y-3">
      <span className="sr-only">読み込み中です</span>
      <div className="h-10 w-2/3 rounded-2xl bg-line/60 animate-pulse motion-reduce:animate-none" />
      <div className="h-64 rounded-2xl border border-line bg-line/30 animate-pulse motion-reduce:animate-none" />
      <div className="h-24 rounded-2xl border border-line bg-line/30 animate-pulse motion-reduce:animate-none" />
    </div>
  );
}

async function HomeContent({ searchParams }: { searchParams: Promise<{ view?: string; m?: string }> }) {
  const { view, m } = await searchParams;
  const now = new Date();
  const todayKey = ymd(now.toISOString());
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? "") ? (m as string) : todayKey.slice(0, 7);
  const [year, month] = ym.split("-").map(Number);
  // 互いに独立な読み取り(イベント・ログイン中の本人)は同時に行う。本人の確認は layout と共有(同じリクエスト内で1回)。
  const [{ events, error }, member] = await Promise.all([load(), getMemberForRender().catch(() => null)]);
  const inMonth = events.filter((e) => ymd(e.startAt).startsWith(ym));
  const published = inMonth.filter((e) => e.status === "published");
  // 参加表明の一覧・会場リンク・申込済みの確認は、月のイベントが決まったあと、同時に行う。どれも、取得できなくてもカレンダー自体は表示する。
  // 申込済みは、ログイン中のときだけ調べる(申込ボタンを押せなくするため)。
  const [participants, links, regs] = await Promise.all([
    view === "list" ? Promise.resolve({} as Record<string, PublicParticipants>) : listPublicParticipants(published.map((e) => e.id)).catch(() => ({} as Record<string, PublicParticipants>)),
    venueLinks(inMonth.map((e) => e.venue)), // 会場 → Googleマップのリンク(登録がなければ会場名の検索)
    member ? listMemberRegistrations(member.id, published).catch(() => []) : Promise.resolve([]),
  ]);
  const applied: Record<string, "confirmed" | "waiting"> = {};
  for (const r of regs) if (r.status !== "cancelled" && r.status !== "expired") applied[r.event.id] = r.status === "confirmed" ? "confirmed" : "waiting";
  return (
    <main>
      {error && <p role="alert" className="mt-3 rounded-2xl border border-line p-3 text-sm">イベント情報を読み込めませんでした。時間をおいて再度お試しください。</p>}
      <CalendarView key={`${ym}-${view ?? "month"}`} year={year} month={month} events={inMonth} todayKey={todayKey} nowIso={now.toISOString()} view={view === "list" ? "list" : "month"} participants={participants} venueLinks={links} applied={applied} />
    </main>
  );
}
