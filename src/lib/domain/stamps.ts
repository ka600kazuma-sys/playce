// スタンプカードの計算(画面・保存に依存しない純粋関数)。
// ポイントは1イベントにつき1回、タグをかざしたときに付く。5ポイントの次は0に戻り、1ポイント目から貯め直す。
// 割引は「その回(何ポイント目の来場か)」で決まる: 3ポイント目と5ポイント目の回に、主催者が決めた金額を引く。
import { createHmac, timingSafeEqual } from "node:crypto";

export const STAMP_SPORTS = ["badminton", "volleyball"] as const;
export type StampSport = (typeof STAMP_SPORTS)[number];
export const isStampSport = (s: unknown): s is StampSport => typeof s === "string" && (STAMP_SPORTS as readonly string[]).includes(s);
export const STAMP_SPORT_LABEL: Record<StampSport, string> = { badminton: "バドミントン", volleyball: "バレーボール" };

export const CYCLE = 5;
export const TIER_POINTS = [3, 5] as const;
export type Tiers = { 3: number; 5: number };
export type AllTiers = Record<StampSport, Tiers>;

// 初期値(控えめ)。主催者が管理画面で変更できる。
export const DEFAULT_TIERS: AllTiers = {
  badminton: { 3: 100, 5: 200 },
  volleyball: { 3: 100, 5: 200 },
};
const MAX_DISCOUNT_YEN = 100_000;

const isYen = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_DISCOUNT_YEN;

// 保存値・入力値の検証。不正なら null(呼び出し側で既定値や拒否にする)。
export function parseTiers(input: unknown): AllTiers | null {
  if (typeof input !== "object" || input === null) return null;
  const out = {} as AllTiers;
  for (const s of STAMP_SPORTS) {
    const t = (input as Record<string, unknown>)[s];
    if (typeof t !== "object" || t === null) return null;
    const a = (t as Record<string, unknown>)["3"], b = (t as Record<string, unknown>)["5"];
    if (!isYen(a) || !isYen(b)) return null;
    out[s] = { 3: a, 5: b };
  }
  return out;
}

// 次に付くポイント(5の次は1)。
export const nextPoints = (points: number) => (points >= CYCLE ? 1 : Math.max(0, Math.floor(points)) + 1);

// 今日の来場が「何ポイント目」か。すでにかざした後なら、いまのポイントがそれ。まだなら、次に付くポイント。
export const visitIndex = (points: number, tappedThisEvent: boolean) => (tappedThisEvent ? Math.min(Math.max(points, 1), CYCLE) : nextPoints(points));

// その回の割引額。参加費を超えない。
export function discountFor(index: number, tiers: Tiers, baseFeeYen: number): number {
  const d = index === 3 ? tiers[3] : index === 5 ? tiers[5] : 0;
  return Math.max(0, Math.min(d, Math.max(0, baseFeeYen)));
}

// タグを読み取れる時間: 開始の3時間前から、終了の6時間後まで。
export const TAP_BEFORE_MS = 3 * 3600e3;
export const TAP_AFTER_MS = 6 * 3600e3; // 開催直後の「いまのイベント」とみなす時間(チケット表示用)
export const TAP_LOOKBACK_MS = 90 * 864e5; // 付け忘れの後づけを受け付ける期間(終了から90日)
export function tapWindow(event: { startAt: string; endAt: string }, nowMs: number): "open" | "early" | "late" {
  const s = new Date(event.startAt).getTime(), e = new Date(event.endAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "late";
  if (nowMs < s - TAP_BEFORE_MS) return "early";
  if (nowMs > e + TAP_LOOKBACK_MS) return "late";
  return "open";
}

export type TapResult = "ok" | "off" | "noreg" | "already" | "early" | "late" | "unsupported" | "invalid" | "bad";
export type TapInput = {
  sportSupported: boolean; enabled: boolean; hasConfirmedRegistration: boolean; window: "open" | "early" | "late"; alreadyTapped: boolean; points: number;
};
// タグをかざしたときの判定。順序: 対象外の競技 → 時間外 → 申込なし → OFF → 取得済み → 付与。
export function decideTap(i: TapInput): { result: TapResult; pointsAfter: number } {
  const keep = { pointsAfter: i.points };
  if (!i.sportSupported) return { result: "unsupported", ...keep };
  if (i.window === "early") return { result: "early", ...keep };
  if (i.window === "late") return { result: "late", ...keep };
  if (!i.hasConfirmedRegistration) return { result: "noreg", ...keep };
  if (!i.enabled) return { result: "off", ...keep };
  if (i.alreadyTapped) return { result: "already", ...keep };
  return { result: "ok", pointsAfter: nextPoints(i.points) };
}

// 付け忘れ用のQR: 1イベント・個数(1か2)ごとの署名つきURL。ポイントは、1個ずつ nextPoints を重ねて付ける(5の次は1)。
export const QR_COUNTS = [1, 2] as const;
export type QrCount = (typeof QR_COUNTS)[number];
export const isQrCount = (n: unknown): n is QrCount => n === 1 || n === 2;
export const addPoints = (points: number, count: number) => { let p = points; for (let i = 0; i < count; i++) p = nextPoints(p); return p; };
const qrMac = (secret: string, eventId: string, count: number) => createHmac("sha256", secret).update(`stamp-qr:v1:${eventId}:${count}`).digest("base64url").slice(0, 32);
export const qrToken = (secret: string, eventId: string, count: number) => qrMac(secret, eventId, count);
export function verifyQrToken(secret: string, eventId: string, count: number, token: string): boolean {
  if (secret.length < 16 || !isQrCount(count) || !/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const a = Buffer.from(token), b = Buffer.from(qrMac(secret, eventId, count));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- タグのURL(HMACで署名。DBには版だけ保存し、秘密そのものは保存しない) ----
// タグは競技ごとに1枚(バドミントン用・バレーボール用)で、毎回同じものを使う。署名の対象は「競技+版」。
// 再発行 = その競技の版を1つ上げる。古い版のURLは検証で落ちる。別の競技のタグは使えない。
const tagMac = (secret: string, sport: string, version: number) =>
  createHmac("sha256", secret).update(`stamp-tag:v2:${sport}:${version}`).digest("base64url").slice(0, 32);

export const tagToken = (secret: string, sport: string, version: number) => `${version}.${tagMac(secret, sport, version)}`;

export function verifyTagToken(secret: string, sport: string, currentVersion: number, token: string): boolean {
  if (secret.length < 16 || !/^\d{1,6}\.[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const [v, mac] = token.split(".");
  if (Number(v) !== currentVersion) return false;
  const a = Buffer.from(mac), b = Buffer.from(tagMac(secret, sport, currentVersion));
  return a.length === b.length && timingSafeEqual(a, b);
}
