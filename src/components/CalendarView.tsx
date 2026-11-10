"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { ParticipantList } from "./ParticipantList";
import type { PublicParticipants } from "@/lib/domain/participants";
import { SPORT_LABEL, type PublicEvent } from "@/lib/domain/events";
import { WEEKDAYS, dateLabel, holidaysOf, monthGrid, shiftYm, toKey, ymText } from "@/lib/domain/calendar";

const EN = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const SHORT: Record<string, string> = { badminton: "バド", volleyball: "バレー", other: "他" };
const BADGE: Record<string, string> = { cancelled: "中止", postponed: "延期" };
const TZ = "Asia/Tokyo";
const dayKey = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso));
const hm = (iso: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

// 月間カレンダー。日付を選ぶと、その日の開催情報と申込ボタンを下に表示する(実際の登録データのみ)。
// events は公開してよいフィールドだけ(サーバーで検証済み)。nowIso はサーバー時刻(ハイドレーション差を避ける)。
export function CalendarView({ year, month, events, todayKey, nowIso, view, participants }: { year: number; month: number; events: PublicEvent[]; todayKey: string; nowIso: string; view: "month" | "list"; participants: Record<string, PublicParticipants> }) {
  const hol = holidaysOf(year);
  const inMonthToday = todayKey.startsWith(ymText(year, month));
  const [selected, setSelected] = useState<string | null>(inMonthToday ? todayKey : null);
  const byDay = new Map<string, PublicEvent[]>();
  for (const e of events) { const k = dayKey(e.startAt); byDay.set(k, [...(byDay.get(k) ?? []), e].sort((a, b) => a.startAt.localeCompare(b.startAt))); }
  const prev = shiftYm(year, month, -1), next = shiftYm(year, month, 1);
  const q = view === "list" ? "&view=list" : "";
  const sel = selected ? selected.split("-").map(Number) : null;

  return (
    <div className="grid gap-4 pt-3.5 md:grid-cols-[1.4fr_1fr] md:items-start">
      <section>
        <div className="mb-2 flex items-center gap-1">
          <Link href={`/?m=${ymText(prev.y, prev.m)}${q}`} aria-label="前の月" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-tint"><Icon name="prev" /></Link>
          <h1 className="m-0 flex flex-1 items-baseline justify-center gap-2.5 whitespace-nowrap font-serif font-medium">
            <span className="text-base">{year}年</span><span className="text-[32px] font-bold leading-none">{month}月</span>
            <span className="hidden border-l border-line pl-2.5 text-[11px] leading-snug tracking-[.16em] text-soft min-[400px]:block"><span className="block">{year}</span>{EN[month - 1]}</span>
          </h1>
          <Link href={`/?m=${ymText(next.y, next.m)}${q}`} aria-label="次の月" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-tint"><Icon name="next" /></Link>
          <Link href={`/${view === "list" ? "?view=list" : ""}`} className="min-h-9 whitespace-nowrap rounded-full border border-blue px-3.5 py-1.5 text-blue">今日</Link>
        </div>

        {view === "month" ? (
          <table className="w-full table-fixed border-collapse" aria-label={`${year}年${month}月`}>
            <thead><tr>{WEEKDAYS.map((w, i) => <th key={w} scope="col" className={`border-b border-line py-2 font-serif text-sm font-normal ${i === 0 ? "text-sun" : i === 6 ? "text-sat" : ""}`}>{w}</th>)}</tr></thead>
            <tbody>
              {monthGrid(year, month).map((week, wi) => (
                <tr key={wi}>
                  {week.map((d, i) => {
                    if (!d) return <td key={i} className="border-b border-line" />;
                    const key = toKey(year, month, d), evs = byDay.get(key) ?? [], on = selected === key;
                    const tone = hol[key] || i === 0 ? "text-sun" : i === 6 ? "text-sat" : "text-ink";
                    return (
                      <td key={i} className="h-[60px] border-b border-line p-0 text-center align-top">
                        <button type="button" onClick={() => setSelected(key)} aria-pressed={on} aria-label={`${dateLabel(year, month, d)}${evs.length ? `、開催${evs.length}件` : ""}`}
                          className={`flex h-full min-h-14 w-full flex-col items-center gap-0.5 pb-1 pt-1.5 font-serif text-xl ${tone}`}>
                          <span className={`grid h-[38px] w-[38px] place-items-center rounded-full ${on ? "bg-blue text-white" : key === todayKey ? "ring-[1.5px] ring-inset ring-blue" : "hover:bg-tint"}`}>{d}</span>
                          {evs.slice(0, 1).map((e) => <span key={e.id} className={`max-w-full truncate rounded-md bg-tint px-1.5 py-[3px] font-sans text-[10px] leading-none text-navy ${e.status === "cancelled" ? "line-through opacity-70" : ""}`}>{SHORT[e.sport]}</span>)}
                          {evs.length > 1 && <span className="rounded-md bg-tint px-1.5 py-[3px] font-sans text-[10px] leading-none text-navy">+{evs.length - 1}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="space-y-2">
            {events.length === 0 && <li className="text-sm text-soft">この月のイベントはありません。</li>}
            {[...events].sort((a, b) => a.startAt.localeCompare(b.startAt)).map((e) => (
              <li key={e.id}><Link href={`/events/${e.id}`} className="block rounded-2xl border border-line p-3">
                <div className="text-sm text-soft">{Number(dayKey(e.startAt).slice(8))}日 {hm(e.startAt)}〜{hm(e.endAt)}</div>
                <div className="font-semibold">{BADGE[e.status] ? `【${BADGE[e.status]}】` : ""}{e.title}</div>
                <div className="text-sm">{SPORT_LABEL[e.sport]} / {e.venue} / {e.feeYen.toLocaleString()}円</div>
              </Link></li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-right text-xs"><Link href={view === "list" ? `/?m=${ymText(year, month)}` : `/?m=${ymText(year, month)}&view=list`} className="text-soft underline">{view === "list" ? "月表示に戻す" : "一覧で見る"}</Link></p>
      </section>

      {view === "month" && (
        <section aria-live="polite" className="grid gap-3.5 rounded-[18px] border border-line bg-surface p-4">
          {!sel ? <p className="text-sm text-soft">日付を選ぶと、その日の開催情報を表示します。</p> : (
            <>
              <h2 className="m-0 font-serif text-lg font-medium text-navy">{dateLabel(sel[0], sel[1], sel[2])}</h2>
              {(byDay.get(selected!) ?? []).length === 0 && <p className="text-sm text-soft">この日の開催はありません。</p>}
              {(byDay.get(selected!) ?? []).map((e) => <EventCard key={e.id} e={e} nowIso={nowIso} p={participants[e.id]} showParticipants={e.status === "published"} />)}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function EventCard({ e, nowIso, p, showParticipants }: { e: PublicEvent; nowIso: string; p: PublicParticipants | undefined; showParticipants: boolean }) {
  const started = new Date(e.startAt) <= new Date(nowIso);
  return (
    <article className="grid gap-2 border-t border-line pt-3.5 first:border-t-0 first:pt-0">
      <h3 className="m-0 flex flex-wrap items-center gap-2.5 font-serif text-2xl">
        <Link href={`/events/${e.id}`}>{e.title}</Link>
        {BADGE[e.status] && <span className="rounded-full bg-[#fde7e9] px-3 py-1 font-sans text-xs text-[#9b1c27]">{BADGE[e.status]}</span>}
      </h3>
      <ul className="grid gap-1.5 text-[15px]">
        <li className="flex items-center gap-3"><Icon name="pin" className="h-5 w-5 flex-none text-soft" />{e.venue}</li>
        <li className="flex items-center gap-3"><Icon name="clock" className="h-5 w-5 flex-none text-soft" />{hm(e.startAt)}–{hm(e.endAt)}</li>
        <li className="flex items-center gap-3"><Icon name="yen" className="h-5 w-5 flex-none text-soft" />{e.feeYen === 0 ? "無料" : `${e.feeYen.toLocaleString()}円`}</li>
      </ul>
      {showParticipants && <ParticipantList p={p} />}
      {e.status === "published" && !started
        ? <Link href={`/events/${e.id}/apply`} className="grid min-h-[52px] place-items-center rounded-2xl bg-navy-deep text-lg font-semibold tracking-widest text-white">参加申込</Link>
        : <p className="text-sm text-soft">{e.status === "cancelled" ? "この開催は中止になりました。" : e.status === "postponed" ? "延期になりました。日程が決まり次第お知らせします。" : "受付は終了しました。"}</p>}
    </article>
  );
}
