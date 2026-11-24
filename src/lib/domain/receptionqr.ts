// 受付QR(ふりた表示用)。秘密鍵はサーバーだけが持ち、ふりたには「事前生成した30秒ごとのトークン一覧」だけを渡す。
// トークン = `${slot}.${mac}`。slot は30秒刻みの番号、mac は HMAC(eventId, slot)。サーバーで mac と slot の鮮度を検証する。
import { createHmac, timingSafeEqual } from "node:crypto";

export const SLOT_MS = 30_000;
export const GRACE_SLOTS = 2; // 読み取りの遅れ・時計ずれの許容(±60秒)
export const MAX_TOKENS = 1440; // 12時間分。上限を超える要求は拒否
const mac = (secret: string, eventId: string, slot: number) => createHmac("sha256", secret).update(`reception-qr:v1:${eventId}:${slot}`).digest("base64url").slice(0, 32);
export const slotOf = (ms: number) => Math.floor(ms / SLOT_MS);

export function issueTokens(secret: string, eventId: string, fromMs: number, toMs: number): { slot: number; token: string }[] {
  if (secret.length < 16 || !(toMs > fromMs)) return [];
  const a = slotOf(fromMs), b = slotOf(toMs);
  if (b - a + 1 > MAX_TOKENS) return [];
  const out: { slot: number; token: string }[] = [];
  for (let s = a; s <= b; s++) out.push({ slot: s, token: `${s}.${mac(secret, eventId, s)}` });
  return out;
}

export type QrCheck = "ok" | "bad" | "expired" | "early";
// window: そのイベントでQRを使ってよい期間(開始の少し前〜終了の少し後)。
export function verifyToken(secret: string, eventId: string, token: string, nowMs: number, window: { fromMs: number; toMs: number }): QrCheck {
  if (secret.length < 16 || !/^\d{1,9}\.[A-Za-z0-9_-]{32}$/.test(token)) return "bad";
  const [s, m] = token.split(".");
  const slot = Number(s);
  const x = Buffer.from(m), y = Buffer.from(mac(secret, eventId, slot));
  if (x.length !== y.length || !timingSafeEqual(x, y)) return "bad";
  if (slot * SLOT_MS < window.fromMs - SLOT_MS || slot * SLOT_MS > window.toMs) return "bad"; // 期間外に発行されたものは無効
  const d = slotOf(nowMs) - slot;
  if (d > GRACE_SLOTS) return "expired";
  if (d < -GRACE_SLOTS) return "early";
  return "ok";
}

// 当日参加の自己登録期限: 開催日(JST)の23:59:59まで。翌日0:00(JST)以降は不可。管理者は対象外。
const JST_MS = 9 * 3600e3;
export const jstDeadline = (startAtMs: number) => Math.floor((startAtMs + JST_MS) / 864e5) * 864e5 + 864e5 - JST_MS; // 排他的上限
export type SelfReg = "ok" | "needs_approval" | "closed";
// 開催終了後は当日中でも申請のみ(承認必要)。翌日以降は拒否。
export function selfRegistration(nowMs: number, startAtMs: number, endAtMs: number): SelfReg {
  if (nowMs >= jstDeadline(startAtMs)) return "closed";
  return nowMs > endAtMs ? "needs_approval" : "ok";
}

// ---- ログイン前に読み取った受付QRの「保留」(Cookie)。新規登録などに時間がかかっても、読み取った時点のQRで受付を続けられるようにする ----
// 保留 = イベントID・トークン・読み取り時刻を、サーバーの鍵で署名したもの(改ざん不可)。有効は15分。受付は読み取り時刻のQRとして検証する(期限は延びない)。
export const PENDING_MAX_MS = 15 * 60e3;
const pmac = (secret: string, eventId: string, token: string, ts: number) => createHmac("sha256", secret).update(`rq-pend:v1:${eventId}:${token}:${ts}`).digest("base64url").slice(0, 32);
export const makePending = (secret: string, eventId: string, token: string, ts: number) => `${eventId}~${token}~${ts}~${pmac(secret, eventId, token, ts)}`;
export function parsePending(secret: string, v: string, nowMs: number): { eventId: string; token: string; ts: number } | null {
  const m = /^([A-Za-z0-9_-]{1,64})~(\d{1,9}\.[A-Za-z0-9_-]{32})~(\d{10,14})~([A-Za-z0-9_-]{32})$/.exec(v);
  if (!m || secret.length < 16) return null;
  const ts = Number(m[3]);
  if (!(ts <= nowMs + 5000) || nowMs - ts > PENDING_MAX_MS) return null;
  const a = Buffer.from(m[4]), b = Buffer.from(pmac(secret, m[1], m[2], ts));
  return a.length === b.length && timingSafeEqual(a, b) ? { eventId: m[1], token: m[2], ts } : null;
}
