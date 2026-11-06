import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { waitlistDeadline } from "./waitlist.ts";

export type RegStatus = "confirmed" | "waitlisted" | "offered" | "cancelled" | "expired";

export const MAX_PARTY = 10;

const nick = z.string().trim().min(1, "ニックネームを入力してください").max(30, "ニックネームは30文字以内で入力してください");

// 代表者のニックネーム + 同行者のニックネーム(代表者による複数人申込)
export const registrationInputSchema = z.object({
  nickname: nick,
  members: z.array(nick).max(MAX_PARTY - 1).default([]),
  agreedRules: z.literal(true, { message: "重要ルールへの同意が必要です" }),
  confirmDuplicate: z.boolean().default(false),
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export const membersUpdateSchema = z.object({
  nickname: nick,
  members: z.array(nick).max(MAX_PARTY - 1).default([]),
});

export type RegRow = {
  id: string;
  status: RegStatus;
  partySize: number;
  createdAt: number;
  offerExpiresAt: number | null;
};
export type RegPatch = { status: RegStatus; offerExpiresAt?: number | null };

const isActive = (s: RegStatus) => s === "confirmed" || s === "offered";

// 期限切れの繰上げ提示を失効させ、空き枠があればキャンセル待ちを申込順(FIFO)に繰り上げる。
// 先頭が枠に入らない場合は、後続の小さい申込を飛ばさず待つ(順番繰上げ)。
export function rebalance(
  capacity: number | null,
  rows: RegRow[],
  eventStart: Date,
  now: Date,
): Map<string, RegPatch> {
  const patches = new Map<string, RegPatch>();
  const status = new Map(rows.map((r) => [r.id, r.status]));
  for (const r of rows) {
    if (r.status === "offered" && r.offerExpiresAt !== null && r.offerExpiresAt <= now.getTime()) {
      patches.set(r.id, { status: "expired", offerExpiresAt: null });
      status.set(r.id, "expired");
    }
  }
  let active = rows.filter((r) => isActive(status.get(r.id)!)).reduce((n, r) => n + r.partySize, 0);
  const waiting = rows.filter((r) => status.get(r.id) === "waitlisted").sort((a, b) => a.createdAt - b.createdAt);
  for (const r of waiting) {
    if (capacity !== null && active + r.partySize > capacity) break;
    patches.set(r.id, { status: "offered", offerExpiresAt: waitlistDeadline(now, eventStart).getTime() });
    active += r.partySize;
  }
  return patches;
}

// 新規申込の状態。待ち行列がある場合や満員の場合は、キャンセル待ちにする。
export function decideInitialStatus(capacity: number | null, rows: RegRow[], partySize: number): "confirmed" | "waitlisted" {
  if (capacity === null) return "confirmed";
  const hasWaiting = rows.some((r) => r.status === "waitlisted");
  const active = rows.filter((r) => isActive(r.status)).reduce((n, r) => n + r.partySize, 0);
  return !hasWaiting && active + partySize <= capacity ? "confirmed" : "waitlisted";
}

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

// 個別管理URL用の推測できないトークン(256bit)。DBにはハッシュだけを保存する。
export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}
export const isTokenShape = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

// 日程変更(開始日時の変更)時は、既存の申込を維持したまま参加継続の意思確認を求める。
export const RECONFIRM_STATUSES: readonly RegStatus[] = ["confirmed", "waitlisted", "offered"];
export const needsReconfirm = (prevStartAt: string, nextStartAt: string) => new Date(prevStartAt).getTime() !== new Date(nextStartAt).getTime();
