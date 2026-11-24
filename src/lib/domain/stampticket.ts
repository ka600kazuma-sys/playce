// チケット1枚の表示内容(純粋関数)。画面は、この結果をそのまま描くだけにする。
// 2026-11: 直接値引きは廃止(特典はクーポン)。チケットは参加費を割り引かず、「次の特典」を案内する。
import { CYCLE, type StampSport } from "./stamps.ts";
import { lapParity, pointsToNextReward, type LapRewards, type Reward } from "./stampcard2.ts";

export type TicketInput = {
  sport: StampSport; enabled: boolean; points: number; lap: number; rewards: LapRewards; tapped: boolean;
  event: { startAt: string; venue: string } | null;
  feeYen: number; // 参加費(申込時の料金)
  partySize: number;
  tapPoints?: number | null;          // このイベントでかざしたときの周内ポイント
};
export const rewardText = (r: Reward) => (r.kind === "free" ? "参加費1回無料" : `${r.yen}円引き`);
export const rewardShort = (r: Reward) => (r.kind === "free" ? "無料" : `${r.yen}円引`);
export type Slot = { n: number; on: boolean; tier: boolean; label: string; isNew: boolean };
export type TicketModel = {
  sport: StampSport; label: string; en: string; code: string; accent: string;
  enabled: boolean; points: number; lap: number; tapped: boolean;
  hasEvent: boolean; startAt: string | null; venue: string; venueHref: string | null; participant: string; serial: string;
  phase: "today" | "next"; kicker: string; // today: かざす前=今日の参加費 / next: かざした後=次回の参加費(目安)
  baseFeeYen: number; priceYen: number; discountYen: number; nextIndex: number; nextText: string;
  slots: Slot[];
};

const META: Record<StampSport, { label: string; en: string; code: string; accent: string }> = {
  badminton: { label: "バドミントン", en: "BADMINTON", code: "BD", accent: "#0f3f82" },
  volleyball: { label: "バレーボール", en: "VOLLEYBALL", code: "VB", accent: "#2f6fd0" },
};

export function buildTicketModel(t: TicketInput, nickname: string, newIndex = 0, venueHref: string | null = null): TicketModel {
  const m = META[t.sport];
  const phase = t.tapped ? "next" : "today";
  const par = lapParity(t.lap), rw = t.rewards[par];
  const toNext = pointsToNextReward({ lap: t.lap, points: t.points }), nextPt = t.points < 3 ? 3 : 5;
  const nextText = `${t.lap}周目 ― ${nextPt}ポイントで${rewardText(rw[nextPt as 3 | 5])}(あと${toNext}ポイント)`; // 参加予定の有無にかかわらず、カードの状態から出す
  const slots: Slot[] = Array.from({ length: CYCLE }, (_, i) => {
    const n = i + 1, on = n <= t.points, tier = n === 3 || n === 5;
    return { n, on, tier: tier && !on, label: on ? `${n}pt` : tier ? rewardShort(rw[n as 3 | 5]) : "通常", isNew: newIndex === n && on };
  });
  return {
    sport: t.sport, ...m, accent: par === "even" ? "#8a5d0b" : m.accent, enabled: t.enabled, points: t.points, lap: t.lap, tapped: t.tapped,
    hasEvent: !!t.event, startAt: t.event?.startAt ?? null, venue: t.event?.venue ?? "", venueHref: t.event ? venueHref : null,
    serial: `${m.code}-${t.event ? t.event.startAt.slice(0, 10).replaceAll("-", "") : "00000000"}`,
    participant: t.event ? `${nickname}${t.partySize > 1 ? ` ほか${t.partySize - 1}名` : ""}` : "",
    phase, kicker: phase === "today" ? "TODAY'S ENTRY / 本日の参加費" : "NEXT ENTRY / 次回の参加費",
    baseFeeYen: t.feeYen, priceYen: t.feeYen, discountYen: 0, nextIndex: Math.min(t.points + 1, CYCLE), nextText, slots,
  };
}

// かざした結果(?tap=...)の、チケット上に出す短い案内。
export const TAP_NOTICE: Record<string, string> = {
  off: "スタンプカードがOFFのため、スタンプは押されませんでした",
  noreg: "スタンプを付けられる、参加確定の申込がありません(終了から90日以内のイベントが対象です)",
  already: "付けられるイベントは、すべて取得済みです",
  early: "まだ開始前です(開始の3時間前から読み取れます)",
  late: "終了から90日をすぎたイベントには、付けられません",
  unsupported: "このイベントは、スタンプの対象外です",
  invalid: "このタグは使えません",
  retry: "読み取れませんでした。もう一度かざしてください",
  busy: "アクセスが集中しています。少し待って、もう一度かざしてください",
  bad: "このタグは無効です。主催者にお知らせください",
};
