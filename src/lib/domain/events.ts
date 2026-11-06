import { z } from "zod";

export const SPORTS = ["badminton", "volleyball", "other"] as const;
export type Sport = (typeof SPORTS)[number];

export const SPORT_LABEL: Record<Sport, string> = {
  badminton: "バドミントン",
  volleyball: "バレーボール",
  other: "その他",
};

export const EVENT_STATUS = ["draft", "published", "hidden", "cancelled", "postponed"] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];

// events コレクション。公開してよいフィールドのみを持つ(参加者氏名・会計は別コレクション)。
export const eventSchema = z.object({
  title: z.string().min(1).max(100),
  sport: z.enum(SPORTS),
  venue: z.string().min(1).max(100),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  feeYen: z.number().int().min(0).max(1_000_000),
  capacity: z.number().int().min(1).max(10_000).nullable(),
  belongings: z.string().max(500).default(""),
  notes: z.string().max(1000).default(""),
  status: z.enum(EVENT_STATUS),
  seriesId: z.string().max(64).optional(), // 定期開催の同一シリーズ
}).refine((e) => new Date(e.endAt) > new Date(e.startAt), { message: "終了時刻は開始時刻より後にしてください", path: ["endAt"] });
export type EventInput = z.infer<typeof eventSchema>;
export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "下書き", published: "公開中", hidden: "非表示", cancelled: "中止", postponed: "延期",
};
export type PublicEvent = EventInput & { id: string };

export const PUBLIC_STATUSES: readonly EventStatus[] = ["published", "cancelled", "postponed"];

// 公開状態の並び順(フォームの選択肢)。「公開中」を一番上にする。
export const STATUS_ORDER: readonly EventStatus[] = ["published", "draft", "hidden", "postponed", "cancelled"];

// イベント削除の安全制限。入金・経費の記録(会計の正本)があるイベントは削除できない(「非表示」にする)。
export type DeletionInfo = { registrations: number; activeRegistrations: number; payments: number; expenses: number; accountingClosed: boolean };
export function deletionBlock(i: Pick<DeletionInfo, "payments" | "expenses" | "accountingClosed">): string | null {
  if (i.payments > 0 || i.expenses > 0 || i.accountingClosed)
    return "入金・経費・会計確定の記録があるため、削除できません。会計の記録を守るためです。参加者に見せたくない場合は、公開状態を「非表示」にしてください。";
  return null;
}
