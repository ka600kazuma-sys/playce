import "server-only";
import { db } from "@/lib/firebase/admin";
import type { RegStatus } from "@/lib/domain/registration";
import { amountDue } from "@/lib/domain/reception";
import { classifyCheckIn } from "@/lib/domain/offline";
import { currentNicknames } from "@/lib/repo/members";

// 管理者専用。呼び出し側で requireAdmin() を済ませること。
export type RegView = {
  id: string; nickname: string; members: string[]; partySize: number; status: RegStatus;
  feeYen: number; paidYen: number; checkedIn: boolean; source: string; createdAt: number; reconfirm: boolean; publicHidden: boolean; memberId: string | null;
};
export type PaymentView = { id: string; at: number; by: string; amountYen: number; allocations: { regId: string; amountYen: number }[]; voided: boolean; voidReason?: string };

const ev = (id: string) => db().collection("events").doc(id);
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
type Raw = Partial<RegView> & { nickname: string; members: string[]; partySize: number; status: RegStatus; feeYen: number };
const view = (id: string, d: Raw): RegView => ({
  id, nickname: d.nickname, members: d.members ?? [], partySize: d.partySize, status: d.status, feeYen: d.feeYen,
  paidYen: d.paidYen ?? 0, checkedIn: d.checkedIn ?? false, source: d.source ?? "web", createdAt: d.createdAt ?? 0, reconfirm: d.reconfirm === true, publicHidden: (d as { publicHidden?: boolean }).publicHidden === true,
  memberId: (d as { memberId?: string }).memberId ?? null,
});

export async function listRegs(eventId: string): Promise<RegView[]> {
  if (!validId(eventId)) return [];
  const snap = await ev(eventId).collection("registrations").orderBy("createdAt").get();
  const rows = snap.docs.map((d) => view(d.id, d.data() as Raw));
  const names = await currentNicknames(rows.map((r) => r.memberId ?? "")); // メンバーは、いまのニックネームで表示する
  return rows.map((r) => (r.memberId && names[r.memberId] ? { ...r, nickname: names[r.memberId] } : r));
}
export async function listPayments(eventId: string): Promise<PaymentView[]> {
  if (!validId(eventId)) return [];
  const snap = await ev(eventId).collection("payments").orderBy("at", "desc").limit(200).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentView, "id">) }));
}

const audit = (tx: FirebaseFirestore.Transaction, eventId: string, by: string, action: string, detail: Record<string, unknown>) =>
  tx.set(ev(eventId).collection("audit").doc(), { at: Date.now(), by, action, ...detail });

export type OpResult = "ok" | "not_found" | "invalid" | "closed";

const acct = (id: string) => db().collection("accounting").doc(id);
const isClosedSnap = (s: FirebaseFirestore.DocumentSnapshot) => s.exists && (s.data() as { closed?: boolean }).closed === true;

export async function setCheckedIn(eventId: string, regId: string, value: boolean, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(regId)) return "not_found";
  const ref = ev(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return "not_found";
    tx.update(ref, { checkedIn: value, updatedAt: Date.now() });
    audit(tx, eventId, by, value ? "checkin" : "checkin_undo", { regId });
    return "ok";
  });
}

// 入金。キー(冪等性キー)が同じなら二重に記録しない。支払い超過は拒否する。
export async function recordPayment(eventId: string, key: string, allocations: { regId: string; amountYen: number }[], by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(key) || allocations.length === 0 || allocations.length > 50) return "invalid";
  if (allocations.some((a) => !validId(a.regId) || !Number.isInteger(a.amountYen) || a.amountYen < 1 || a.amountYen > 1_000_000)) return "invalid";
  if (new Set(allocations.map((a) => a.regId)).size !== allocations.length) return "invalid";
  const payRef = ev(eventId).collection("payments").doc(key);
  return db().runTransaction(async (tx) => {
    const [pay, closed, ...regSnaps] = await Promise.all([tx.get(payRef), tx.get(acct(eventId)), ...allocations.map((a) => tx.get(ev(eventId).collection("registrations").doc(a.regId)))]);
    if (pay.exists) return "ok"; // 再送・二重タップ
    if (isClosedSnap(closed)) return "closed";
    const updates: { ref: FirebaseFirestore.DocumentReference; paid: number }[] = [];
    for (let i = 0; i < allocations.length; i++) {
      const s = regSnaps[i];
      if (!s.exists) return "not_found";
      const r = view(s.id, s.data() as Raw);
      if (r.status !== "confirmed") return "invalid";
      if (r.paidYen + allocations[i].amountYen > amountDue(r)) return "invalid";
      updates.push({ ref: s.ref, paid: r.paidYen + allocations[i].amountYen });
    }
    const total = allocations.reduce((n, a) => n + a.amountYen, 0);
    tx.create(payRef, { at: Date.now(), by, amountYen: total, allocations, voided: false });
    for (const u of updates) tx.update(u.ref, { paidYen: u.paid, updatedAt: Date.now() });
    audit(tx, eventId, by, "payment", { paymentId: key, amountYen: total });
    return "ok";
  });
}

// 入金の取り消し。削除せず「取消」として残し、各人の入金額を戻す。
export async function voidPayment(eventId: string, paymentId: string, reason: string, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(paymentId) || reason.length < 1 || reason.length > 200) return "invalid";
  const payRef = ev(eventId).collection("payments").doc(paymentId);
  return db().runTransaction(async (tx) => {
    const [pay, closed] = await Promise.all([tx.get(payRef), tx.get(acct(eventId))]);
    if (!pay.exists) return "not_found";
    const p = pay.data() as Omit<PaymentView, "id">;
    if (p.voided) return "ok";
    if (isClosedSnap(closed)) return "closed";
    const snaps = await Promise.all(p.allocations.map((a) => tx.get(ev(eventId).collection("registrations").doc(a.regId))));
    snaps.forEach((s, i) => {
      if (s.exists) tx.update(s.ref, { paidYen: Math.max(0, ((s.data() as Raw).paidYen ?? 0) - p.allocations[i].amountYen), updatedAt: Date.now() });
    });
    tx.update(payRef, { voided: true, voidReason: reason, voidedAt: Date.now(), voidedBy: by });
    audit(tx, eventId, by, "payment_void", { paymentId, reason });
    return "ok";
  });
}

// 個別料金の変更(理由必須)。入金済みの額より低くはできない。
export async function setFeeOverride(eventId: string, regId: string, feeYen: number, reason: string, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(regId) || !Number.isInteger(feeYen) || feeYen < 0 || feeYen > 1_000_000 || reason.length < 1 || reason.length > 200) return "invalid";
  const ref = ev(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx) => {
    const [s, closed] = await Promise.all([tx.get(ref), tx.get(acct(eventId))]);
    if (!s.exists) return "not_found";
    if (isClosedSnap(closed)) return "closed";
    const r = view(s.id, s.data() as Raw);
    if (feeYen * r.partySize < r.paidYen) return "invalid";
    tx.update(ref, { feeYen, updatedAt: Date.now() });
    audit(tx, eventId, by, "fee_override", { regId, from: r.feeYen, to: feeYen, reason });
    return "ok";
  });
}

// 飛び入り追加。当日の現場判断のため、定員に関係なく受付済みの確定として登録する。
export async function addWalkIn(eventId: string, nickname: string, partySize: number, by: string): Promise<OpResult> {
  if (!validId(eventId) || nickname.length < 1 || nickname.length > 30 || !Number.isInteger(partySize) || partySize < 1 || partySize > 10) return "invalid";
  const evRef = ev(eventId);
  return db().runTransaction(async (tx) => {
    const [e, closed] = await Promise.all([tx.get(evRef), tx.get(acct(eventId))]);
    if (!e.exists) return "not_found";
    if (isClosedSnap(closed)) return "closed";
    const ref = evRef.collection("registrations").doc();
    tx.create(ref, {
      nickname, members: Array.from({ length: partySize - 1 }, (_, i) => `${nickname}の同行者${i + 1}`), partySize, status: "confirmed",
      feeYen: (e.data() as { feeYen: number }).feeYen, checkedIn: true, paidYen: 0, source: "walkin",
      offerExpiresAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    audit(tx, eventId, by, "walkin", { regId: ref.id, partySize });
    return "ok";
  });
}

// オフラインで記録した受付チェックの同期。操作ID(opId)で二重実行を防ぎ、他端末で先に変更されていれば競合として返す(保留→主催者が判断)。
export type CheckInOpResult = OpResult | "conflict";
export async function applyCheckInOp(eventId: string, opId: string, regId: string, value: boolean, expect: boolean, force: boolean, by: string): Promise<CheckInOpResult> {
  if (!validId(eventId) || !validId(regId) || !validId(opId)) return "invalid";
  const ref = ev(eventId).collection("registrations").doc(regId), opRef = ev(eventId).collection("ops").doc(opId);
  return db().runTransaction(async (tx): Promise<CheckInOpResult> => {
    const [s, op] = await Promise.all([tx.get(ref), tx.get(opRef)]);
    if (op.exists) return "ok"; // 再送
    if (!s.exists) return "not_found";
    const verdict = classifyCheckIn(view(s.id, s.data() as Raw).checkedIn, expect, value, force);
    if (verdict === "conflict") return "conflict";
    if (verdict === "apply") {
      tx.update(ref, { checkedIn: value, updatedAt: Date.now() });
      audit(tx, eventId, by, value ? "checkin" : "checkin_undo", { regId, opId, forced: force, offline: true });
    }
    tx.create(opRef, { at: Date.now(), by, type: "checkin", regId });
    return "ok";
  });
}

// 公開の参加者一覧に、この人のニックネームを出すか(主催者の判断。不適切な名前などを隠す)。人数には含まれる。
export async function setPublicHidden(eventId: string, regId: string, hidden: boolean, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(regId)) return "not_found";
  const ref = ev(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return "not_found";
    tx.update(ref, { publicHidden: hidden, updatedAt: Date.now() });
    audit(tx, eventId, by, hidden ? "list_hide" : "list_show", { regId });
    return "ok";
  });
}
