import { createHmac, timingSafeEqual } from "node:crypto";

// フォームの描画時刻を署名したトークン。人間らしい入力時間かを、サーバー側で確認する。
export function signFormToken(secret: string, now: number): string {
  const body = String(now);
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyFormToken(secret: string, token: string, now: number, minMs = 3000, maxMs = 2 * 3600 * 1000): boolean {
  const [body, sig] = token.split(".");
  if (!body || !sig || !/^\d{10,16}$/.test(body)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = now - Number(body);
  return age >= minMs && age <= maxMs;
}

// X-Forwarded-For から、信頼できるプロキシ段数(hops)を除いたクライアントIPを取り出す。
// 先頭の値は利用者が偽装できるため使わない。取れないときは "unknown"。
export function clientIp(xff: string | null, hops: number): string {
  const parts = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : "unknown";
}

export const windowIndex = (now: number, windowMs: number) => Math.floor(now / windowMs);
