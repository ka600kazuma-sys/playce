import "server-only";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { db } from "@/lib/firebase/admin";
import { clientIp, windowIndex } from "@/lib/domain/abuse";

export const SCOPES = {
  apply: { limit: 5, windowMs: 10 * 60 * 1000 },   // 申込
  manage: { limit: 30, windowMs: 10 * 60 * 1000 }, // 管理URLの閲覧・変更(トークン総当たり対策を兼ねる)
  login: { limit: 10, windowMs: 10 * 60 * 1000 },  // 主催者ログイン
  contact: { limit: 5, windowMs: 10 * 60 * 1000 }, // 主催者へのメッセージ送信・返信
} as const;
export type Scope = keyof typeof SCOPES;

export async function requestIp(h?: Headers): Promise<string> {
  const hs = h ?? (await headers());
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1);
  return clientIp(hs.get("x-forwarded-for"), hops);
}

// 固定ウィンドウのカウンタ(Firestore)。超過なら false。
// 記録に失敗した場合は許可する(可用性を優先)。その分、他の対策(同意・重複警告・定員)で守る。
export async function allow(scope: Scope, ip: string, h?: Headers): Promise<boolean> {
  void h;
  const { limit, windowMs } = SCOPES[scope];
  const now = Date.now();
  const id = createHash("sha256").update(`${scope}|${ip}|${windowIndex(now, windowMs)}`).digest("hex");
  const ref = db().collection("ratelimits").doc(id);
  try {
    return await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const n = s.exists ? (s.data() as { n: number }).n : 0;
      if (n >= limit) return false;
      tx.set(ref, { scope, n: n + 1, expireAt: new Date(now + 2 * windowMs) }); // expireAt に Firestore の TTL を設定する
      return true;
    });
  } catch (e) {
    console.error("ratelimit error", e instanceof Error ? e.message : e);
    return true;
  }
}
