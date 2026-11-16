// チケット1枚の表示内容(純粋関数)。画面は、この結果をそのまま描くだけにする。
import { CYCLE, TIER_POINTS, discountFor, nextPoints, type StampSport, type Tiers } from "./stamps.ts";

export type TicketInput = {
  sport: StampSport; enabled: boolean; points: number; tiers: Tiers; tapped: boolean;
  event: { startAt: string; venue: string } | null;
  feeYen: number; // 割引前の参加費(申込時の料金)
  partySize: number;
  appliedDiscountYen?: number | null; // 受付で適用済みのスタンプ割引
  tapPoints?: number | null;          // このイベントでかざしたときのポイント
};
export type Slot = { n: number; on: boolean; tier: boolean; label: string; isNew: boolean };
export type TicketModel = {
  sport: StampSport; label: string; en: string; code: string; accent: string;
  enabled: boolean; points: number; tapped: boolean;
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
  // かざす前: 今日の来場(次に付くポイント)の価格。受付で適用済みなら、その割引をそのまま使う(二重に引かない)。
  // かざした後: 次回の来場の目安(このイベントの参加費をもとにした見込み)。
  const index = nextPoints(t.points);
  const raw = !t.event ? 0
    : phase === "today" && t.appliedDiscountYen != null ? Math.min(t.appliedDiscountYen, Math.max(0, t.feeYen))
    : discountFor(index, t.tiers, t.feeYen);
  // 同行者がいる申込は、受付で自動では割引を適用しない(個別に調整する)ため、割引後の金額は出さない。適用済みなら、その額を出す。
  const group = !!t.event && t.partySize > 1 && t.appliedDiscountYen == null;
  const discountYen = group ? 0 : raw;
  const nextTier = TIER_POINTS.find((p) => p >= index);
  const hint = nextTier ? `あと${nextTier - index + 1}回で ${t.tiers[nextTier]}円引き` : "";
  const nextText = !t.event ? ""
    : phase === "next" && t.points >= CYCLE ? "5ポイント達成。次回は0に戻り、1ポイント目から貯め直し"
    : group && raw > 0 ? `${phase === "today" ? "本日は" : "次回は"} ${index}ポイント目 ― ${raw}円引きの回(同行者がいるため、受付で調整します)`
    : discountYen > 0 ? `${phase === "today" ? "本日は" : "次回は"} ${index}ポイント目 ― ${discountYen}円引き${phase === "today" && t.appliedDiscountYen != null ? "(受付で適用済み)" : ""}`
    : hint ? `${phase === "today" ? "本日は" : "次回は"} ${index}ポイント目 ― ${hint}` : `${phase === "today" ? "本日は" : "次回は"} ${index}ポイント目`;
  const slots: Slot[] = Array.from({ length: CYCLE }, (_, i) => {
    const n = i + 1, on = n <= t.points, tier = (TIER_POINTS as readonly number[]).includes(n);
    return { n, on, tier: tier && !on, label: on ? `${n}pt` : tier ? `${t.tiers[n as 3 | 5]}円引` : "通常", isNew: newIndex === n && on };
  });
  return {
    sport: t.sport, ...m, enabled: t.enabled, points: t.points, tapped: t.tapped,
    hasEvent: !!t.event, startAt: t.event?.startAt ?? null, venue: t.event?.venue ?? "", venueHref: t.event ? venueHref : null,
    serial: `${m.code}-${t.event ? t.event.startAt.slice(0, 10).replaceAll("-", "") : "00000000"}`,
    participant: t.event ? `${nickname}${t.partySize > 1 ? ` ほか${t.partySize - 1}名` : ""}` : "",
    phase, kicker: phase === "today" ? "TODAY'S ENTRY / 本日の参加費" : "NEXT ENTRY / 次回の参加費(目安)",
    baseFeeYen: t.feeYen, priceYen: Math.max(0, t.feeYen - discountYen), discountYen, nextIndex: index, nextText, slots,
  };
}

// かざした結果(?tap=...)の、チケット上に出す短い案内。
export const TAP_NOTICE: Record<string, string> = {
  off: "スタンプカードがOFFのため、スタンプは押されませんでした",
  noreg: "いま開催中の、参加確定の申込がありません",
  already: "本日は取得済みです",
  early: "まだ開始前です(開始の3時間前から読み取れます)",
  late: "このイベントの受付は終了しました",
  unsupported: "このイベントは、スタンプの対象外です",
  invalid: "このタグは使えません",
  retry: "読み取れませんでした。もう一度かざしてください",
  busy: "アクセスが集中しています。少し待って、もう一度かざしてください",
  bad: "このタグは無効です。主催者にお知らせください",
};
