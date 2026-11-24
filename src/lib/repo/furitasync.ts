import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import { newTransferCode, normalizeTransferCode, transferCodeHash, transferCodeShape } from "@/lib/domain/member";
import { MAX_TOKENS, SLOT_MS, issueTokens } from "@/lib/domain/receptionqr";
import { formSecret } from "@/lib/repo/formtoken";
import { QR_WINDOW_MS } from "@/lib/repo/receptionqr";

// ふりた(会場のタブレット)への、開催情報と「事前生成した受付QRのトークン一覧」の受け渡し。
// 署名の秘密鍵・管理者の認証情報は、タブレットへ渡さない(渡すのは、期間限定のトークンだけ)。
// 主催者が、イベントごとに「ふりた用コード」を発行(12文字・暗号乱数・6時間・20回まで・イベント限定)。DBにはハッシュだけを保存する(tabletCodes/{ハッシュ})。
const TTL_MS = 6 * 3600e3, MAX_USES = 20;
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export async function issueTabletCode(eventId: string, by: string, now = Date.now()): Promise<{ code: string } | null> {
  if (!validId(eventId)) return null;
  const e = await db().collection("events").doc(eventId).get();
  if (!eventSchema.safeParse(e.data()).success) return null;
  const { code, hash } = newTransferCode();
  await db().collection("tabletCodes").doc(hash).create({ eventId, createdBy: by, createdAt: now, expiresAt: now + TTL_MS, uses: 0 });
  await db().collection("events").doc(eventId).collection("audit").add({ at: now, by, action: "tablet_code_issue" });
  return { code };
}

export type SyncPayload = {
  event: { id: string; title: string; venue: string; startAt: string; endAt: string; multiplier: 1 | 2 | 3 };
  serverNow: number; tokens: string[]; origin?: string;
};
// コードを使って取得(コードの有無・期限・回数・イベントの状態は、区別せず null)。
export async function redeemTabletCode(raw: string, now = Date.now()): Promise<Omit<SyncPayload, "origin"> | null> {
  const norm = normalizeTransferCode(String(raw ?? "").slice(0, 40));
  if (!transferCodeShape(norm)) return null;
  const ref = db().collection("tabletCodes").doc(transferCodeHash(norm));
  const secret = formSecret();
  if (!secret) return null;
  return db().runTransaction(async (tx) => {
    const c = await tx.get(ref);
    const d = c.data();
    if (!d || typeof d.eventId !== "string" || d.expiresAt < now || d.uses >= MAX_USES) return null;
    const ev = await tx.get(db().collection("events").doc(d.eventId));
    const p = eventSchema.safeParse(ev.data());
    if (!p.success || p.data.status !== "published") return null;
    const s = new Date(p.data.startAt).getTime(), en = new Date(p.data.endAt).getTime();
    const from = s - QR_WINDOW_MS, to = Math.min(en + QR_WINDOW_MS, from + (MAX_TOKENS - 1) * SLOT_MS);
    const tokens = issueTokens(secret, d.eventId, from, to).map((t) => t.token);
    if (!tokens.length) return null;
    tx.update(ref, { uses: d.uses + 1, lastUsedAt: now });
    return { event: { id: d.eventId, title: p.data.title, venue: p.data.venue, startAt: p.data.startAt, endAt: p.data.endAt, multiplier: p.data.stampMultiplier }, serverNow: now, tokens };
  });
}
