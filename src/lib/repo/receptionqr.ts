import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import { selfRegistration, verifyToken, type QrCheck } from "@/lib/domain/receptionqr";
import { formSecret } from "@/lib/repo/formtoken";
import { settleVisitStamp } from "@/lib/repo/stamps";

// 受付QR(ふりた表示)を参加者が読んだときの処理。呼び出し側(route)で、ログイン済みの会員IDを渡す。
// 保存: events/{id}/registrations/{既存ID または qr_{会員ID}}、events/{id}/walkinRequests/{会員ID}(管理者の承認待ち)。
// 会員の識別は会員ID(ニックネームでは識別しない)。1人1件(qr_{会員ID} を tx.create → 同時読み取りでも重複しない)。
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const evRef = (id: string) => db().collection("events").doc(id);
export const QR_WINDOW_MS = 2 * 3600e3; // 開催の前後2時間だけ、QRを受け付ける(参加登録の期限=当日23:59JSTとは別)

export type ScanResult = QrCheck | "checked_in" | "already" | "walkin_ok" | "pending" | "waiting" | "closed" | "invalid";
export type ScanOutcome = { result: ScanResult; title?: string; multiplier?: number };

export async function scanReception(memberId: string, eventId: string, token: string, now = Date.now()): Promise<ScanOutcome> {
  if (!validId(memberId) || !validId(eventId)) return { result: "invalid" };
  const secret = formSecret();
  let regId: string | null = null;
  const out = await db().runTransaction(async (tx): Promise<ScanOutcome> => {
    const evSnap = await tx.get(evRef(eventId));
    const p = eventSchema.safeParse(evSnap.data());
    if (!p.success || p.data.status !== "published") return { result: "invalid" };
    const e = p.data, s = new Date(e.startAt).getTime(), en = new Date(e.endAt).getTime();
    const chk = verifyToken(secret, eventId, token, now, { fromMs: s - QR_WINDOW_MS, toMs: en + QR_WINDOW_MS });
    if (chk !== "ok") return { result: chk };
    const [mem, mine, all, req] = await Promise.all([
      tx.get(db().collection("members").doc(memberId)),
      tx.get(evRef(eventId).collection("registrations").where("memberId", "==", memberId)),
      tx.get(evRef(eventId).collection("registrations")),
      tx.get(evRef(eventId).collection("walkinRequests").doc(memberId)),
    ]);
    if (!mem.exists) return { result: "invalid" };
    const base = { title: e.title, multiplier: e.stampMultiplier };
    const confirmed = mine.docs.find((d) => d.data().status === "confirmed");
    if (confirmed) {
      regId = confirmed.id;
      if (confirmed.data().checkedIn === true) return { result: "already", ...base };
      tx.update(confirmed.ref, { checkedIn: true, checkedInAt: now, checkInVia: "qr", updatedAt: now });
      tx.set(evRef(eventId).collection("audit").doc(), { at: now, by: `member:${memberId}`, action: "checkin", regId: confirmed.id, via: "qr" });
      return { result: "checked_in", ...base };
    }
    if (mine.docs.some((d) => d.data().status === "waitlisted" || d.data().status === "offered")) return { result: "waiting", ...base };
    if (req.exists) return { result: "pending", ...base };
    const sr = selfRegistration(now, s, en);
    if (sr === "closed") return { result: "closed", ...base };
    const active = all.docs.filter((d) => d.data().status === "confirmed" || d.data().status === "offered").reduce((n, d) => n + (d.data().partySize ?? 1), 0);
    const full = e.capacity !== null && active + 1 > e.capacity;
    if (sr === "needs_approval" || full) {
      tx.create(req.ref, { memberId, at: now, reason: sr === "needs_approval" ? "after_end" : "full", status: "pending" });
      return { result: "pending", ...base };
    }
    const ref = evRef(eventId).collection("registrations").doc(`qr_${memberId}`);
    tx.create(ref, {
      nickname: mem.data()!.nickname, members: [], partySize: 1, status: "confirmed", feeYen: e.feeYen, checkedIn: true, checkedInAt: now, checkInVia: "qr",
      paidYen: 0, source: "qr_walkin", memberId, offerExpiresAt: null, createdAt: now, updatedAt: now,
    });
    tx.set(evRef(eventId).collection("audit").doc(), { at: now, by: `member:${memberId}`, action: "walkin_qr", regId: ref.id });
    regId = ref.id;
    return { result: "walkin_ok", ...base };
  });
  if ((out.result === "checked_in" || out.result === "walkin_ok" || out.result === "already") && regId) {
    try { await settleVisitStamp(eventId, regId, now); } catch { /* 支払い確認の時点で再度確定を試みる(冪等) */ }
  }
  return out;
}

// 管理者専用(呼び出し側で requireAdmin() を済ませること): 承認待ちの一覧と承認・却下。管理者の追加には日時制限・定員制限を設けない。
export type WalkinRequest = { memberId: string; nickname: string; at: number; reason: "after_end" | "full" };
export async function listWalkinRequests(eventId: string): Promise<WalkinRequest[]> {
  if (!validId(eventId)) return [];
  const snap = await evRef(eventId).collection("walkinRequests").where("status", "==", "pending").get();
  const mems = snap.docs.length ? await db().getAll(...snap.docs.map((d) => db().collection("members").doc(d.id))) : [];
  return snap.docs.map((d, i) => ({ memberId: d.id, nickname: String(mems[i]?.data()?.nickname ?? "(不明)"), at: d.data().at as number, reason: d.data().reason === "full" ? "full" as const : "after_end" as const }))
    .sort((a, b) => a.at - b.at);
}
export type DecideResult = "ok" | "not_found" | "closed";
export async function decideWalkin(eventId: string, memberId: string, approve: boolean, by: string, now = Date.now()): Promise<DecideResult> {
  if (!validId(eventId) || !validId(memberId)) return "not_found";
  const reqRef = evRef(eventId).collection("walkinRequests").doc(memberId), regRef = evRef(eventId).collection("registrations").doc(`qr_${memberId}`);
  let settleId = `qr_${memberId}`;
  const res = await db().runTransaction(async (tx): Promise<DecideResult> => {
    const [e, req, mem, acct, reg, mine] = await Promise.all([tx.get(evRef(eventId)), tx.get(reqRef), tx.get(db().collection("members").doc(memberId)), tx.get(db().collection("accounting").doc(eventId)), tx.get(regRef), tx.get(evRef(eventId).collection("registrations").where("memberId", "==", memberId))]);
    if (!e.exists || !req.exists || req.data()?.status !== "pending" || !mem.exists) return "not_found";
    if (approve && acct.exists && acct.data()?.closed === true) return "closed";
    tx.update(reqRef, { status: approve ? "approved" : "rejected", decidedAt: now, decidedBy: by });
    // 承認待ちの間に、通常の申込で参加確定になっていた場合は、新しい申込を作らず、その申込を受付済みにする(二重登録なし)。
    const confirmed = mine.docs.find((d) => d.data().status === "confirmed");
    if (approve && confirmed) {
      if (confirmed.data().checkedIn !== true) tx.update(confirmed.ref, { checkedIn: true, checkedInAt: now, checkInVia: "approved", updatedAt: now });
      settleId = confirmed.id;
    } else if (approve && (!reg.exists || reg.data()?.status !== "confirmed")) { // 固定IDの申込が取消済みなどで残っている場合も、受付済みの確定申込として作り直す
      tx.set(regRef, {
        nickname: mem.data()!.nickname, members: [], partySize: 1, status: "confirmed", feeYen: (e.data() as { feeYen: number }).feeYen, checkedIn: true, checkedInAt: now, checkInVia: "approved",
        paidYen: 0, source: "qr_walkin", memberId, offerExpiresAt: null, createdAt: now, updatedAt: now,
      });
    }
    tx.set(evRef(eventId).collection("audit").doc(), { at: now, by, action: approve ? "walkin_approve" : "walkin_reject", memberId });
    return "ok";
  });
  if (res === "ok" && approve) { try { await settleVisitStamp(eventId, settleId, now); } catch { /* 冪等 */ } }
  return res;
}

// ログイン前の読み取り: QRが(いま)有効かだけを確かめる(受付はしない)。
export async function peekToken(eventId: string, token: string, now = Date.now()): Promise<QrCheck | "invalid"> {
  if (!validId(eventId)) return "invalid";
  const p = eventSchema.safeParse((await evRef(eventId).get()).data());
  if (!p.success || p.data.status !== "published") return "invalid";
  const s = new Date(p.data.startAt).getTime(), en = new Date(p.data.endAt).getTime();
  return verifyToken(formSecret(), eventId, token, now, { fromMs: s - QR_WINDOW_MS, toMs: en + QR_WINDOW_MS });
}
