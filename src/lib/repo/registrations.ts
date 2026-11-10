import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { eventSchema, type EventInput } from "@/lib/domain/events";
import {
  MAX_PARTY, decideInitialStatus, hashSecret, isTokenShape, newToken, rebalance,
  type RegPatch, type RegRow, type RegStatus,
} from "@/lib/domain/registration";

export type ApplyResult =
  | { ok: true; token: string; status: RegStatus }
  | { ok: false; code: "not_found" | "closed" | "duplicate" | "already" };

export type MyRegistration = {
  status: RegStatus;
  nickname: string;
  members: string[];
  partySize: number;
  feeYen: number;
  offerExpiresAt: number | null;
  reconfirm: boolean; // 日程変更後の参加継続の意思確認待ち
  event: { id: string; title: string; startAt: string };
};

const regs = (eventId: string) => db().collection("events").doc(eventId).collection("registrations");
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

type Doc = { status: RegStatus; partySize: number; createdAt: number; offerExpiresAt: number | null; browserHash?: string; reconfirm?: boolean; memberId?: string };
const toRow = (id: string, d: Doc): RegRow => ({ id, status: d.status, partySize: d.partySize, createdAt: d.createdAt, offerExpiresAt: d.offerExpiresAt ?? null });

async function loadEvent(tx: FirebaseFirestore.Transaction, eventId: string): Promise<EventInput | null> {
  const snap = await tx.get(db().collection("events").doc(eventId));
  if (!snap.exists) return null;
  const parsed = eventSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : null;
}

function applyPatches(tx: FirebaseFirestore.Transaction, eventId: string, patches: Map<string, RegPatch>) {
  for (const [id, p] of patches) tx.update(regs(eventId).doc(id), { ...p, updatedAt: Date.now() });
}

// 申込。人数カウントと繰上げはトランザクションで行い、同時申込でも定員を超えない。
export async function createRegistration(
  eventId: string,
  input: { nickname: string; members: string[]; confirmDuplicate: boolean },
  browserId: string,
  member?: { id: string },
): Promise<ApplyResult> {
  if (!validId(eventId)) return { ok: false, code: "not_found" };
  const { token, hash } = newToken();
  const browserHash = hashSecret(browserId);
  const now = new Date();
  return db().runTransaction(async (tx): Promise<ApplyResult> => {
    const event = await loadEvent(tx, eventId);
    if (!event || event.status === "draft" || event.status === "hidden") return { ok: false, code: "not_found" };
    if (event.status !== "published" || new Date(event.startAt) <= now) return { ok: false, code: "closed" };
    const snap = await tx.get(regs(eventId));
    const docs = snap.docs.map((d) => ({ id: d.id, d: d.data() as Doc }));
    const live = (st: RegStatus) => st !== "cancelled" && st !== "expired";
    // メンバー(ログイン済み)は、1つのイベントに1申込まで(本人確認ができているため、警告ではなく拒否する)。
    if (member && docs.some(({ d }) => d.memberId === member.id && live(d.status))) return { ok: false, code: "already" };
    const dup = !member && docs.some(({ d }) => d.browserHash === browserHash && live(d.status));
    if (dup && !input.confirmDuplicate) return { ok: false, code: "duplicate" };
    const rows = docs.map(({ id, d }) => toRow(id, d));
    const patches = rebalance(event.capacity, rows, new Date(event.startAt), now);
    const after = rows.map((r) => ({ ...r, ...(patches.get(r.id) ?? {}) })) as RegRow[];
    const partySize = 1 + input.members.length;
    const status = decideInitialStatus(event.capacity, after, partySize);
    applyPatches(tx, eventId, patches);
    tx.create(regs(eventId).doc(hash), {
      nickname: input.nickname, members: input.members, partySize, status,
      feeYen: event.feeYen, // 申込時の料金を維持する
      checkedIn: false, paidYen: 0, source: "web",
      offerExpiresAt: null, browserHash, createdAt: Date.now(), updatedAt: Date.now(), consentAt: Date.now(),
      ...(member ? { memberId: member.id } : {}),
    });
    return { ok: true, token, status };
  });
}

export async function getMyRegistration(eventId: string, token: string): Promise<MyRegistration | null> {
  if (!validId(eventId) || !isTokenShape(token)) return null;
  const [reg, ev] = await Promise.all([regs(eventId).doc(hashSecret(token)).get(), db().collection("events").doc(eventId).get()]);
  const parsed = eventSchema.safeParse(ev.data());
  if (!reg.exists || !parsed.success) return null;
  const d = reg.data() as Doc & { nickname: string; members: string[]; feeYen: number };
  return {
    status: d.status, nickname: d.nickname, members: d.members, partySize: d.partySize, feeYen: d.feeYen,
    offerExpiresAt: d.offerExpiresAt ?? null, reconfirm: d.reconfirm === true, event: { id: eventId, title: parsed.data.title, startAt: parsed.data.startAt },
  };
}

type Change = "cancel" | "accept" | "decline" | "edit" | "keep";
export type ChangeResult = "ok" | "not_found" | "closed" | "invalid_state" | "expired";

// 取消・繰上げ回答・編集。開催開始後は変更できない。取消後は空き枠を繰り上げる。
// 申込のトークン(専用URL)で操作する。メンバー(ログイン済み)は changeRegistrationById で、本人の申込だけを操作する。
export async function changeRegistration(
  eventId: string, token: string, change: Change, edit?: { nickname: string; members: string[] },
): Promise<ChangeResult> {
  if (!isTokenShape(token)) return "not_found";
  return changeRegistrationById(eventId, hashSecret(token), change, edit);
}

export async function changeRegistrationById(
  eventId: string, regId: string, change: Change, edit?: { nickname: string; members: string[] }, ownerMemberId?: string,
): Promise<ChangeResult> {
  if (!validId(eventId) || !validId(regId)) return "not_found";
  const ref = regs(eventId).doc(regId);
  const now = new Date();
  return db().runTransaction(async (tx): Promise<ChangeResult> => {
    const event = await loadEvent(tx, eventId);
    const mine = await tx.get(ref);
    if (!event || !mine.exists) return "not_found";
    if (new Date(event.startAt) <= now) return "closed";
    const cur = mine.data() as Doc;
    if (ownerMemberId !== undefined && cur.memberId !== ownerMemberId) return "not_found"; // 他人の申込は、存在しないものとして扱う
    if (cur.status === "cancelled" || cur.status === "expired") return "invalid_state";
    if (change === "keep") { // 日程変更後に「参加を継続する」と回答
      tx.update(ref, { reconfirm: false, reconfirmedAt: Date.now(), updatedAt: Date.now() });
      return "ok";
    }
    const snap = await tx.get(regs(eventId));
    const rows = snap.docs.map((d) => toRow(d.id, d.data() as Doc));
    if (change === "accept" || change === "decline") {
      if (cur.status !== "offered") return "invalid_state";
      if (cur.offerExpiresAt !== null && cur.offerExpiresAt <= now.getTime()) {
        tx.update(ref, { status: "expired", offerExpiresAt: null, updatedAt: Date.now() });
        applyPatches(tx, eventId, rebalance(event.capacity, rows.map((r) => r.id === ref.id ? { ...r, status: "expired" as const } : r), new Date(event.startAt), now));
        return "expired";
      }
    }
    if (change === "edit") {
      if (!edit) return "invalid_state";
      const partySize = 1 + edit.members.length;
      // 人数が増える場合は、枠が足りるときだけ許可する(確定済みの人数を守る)
      if (partySize > cur.partySize && cur.status !== "waitlisted" && event.capacity !== null) {
        const active = rows.filter((r) => r.status === "confirmed" || r.status === "offered").reduce((n, r) => n + r.partySize, 0);
        if (active - cur.partySize + partySize > event.capacity) return "invalid_state";
      }
      tx.update(ref, { nickname: edit.nickname, members: edit.members, partySize, updatedAt: Date.now() });
      return "ok";
    }
    const next: RegStatus = change === "accept" ? "confirmed" : "cancelled";
    tx.update(ref, { status: next, offerExpiresAt: null, updatedAt: Date.now(), ...(next === "cancelled" ? { cancelledAt: FieldValue.serverTimestamp() } : {}) });
    if (next === "cancelled") {
      const after = rows.map((r) => (r.id === ref.id ? { ...r, status: next } : r));
      applyPatches(tx, eventId, rebalance(event.capacity, after, new Date(event.startAt), now));
    }
    return "ok";
  });
}

// ---- メンバーの申込 ----
export type MemberRegistration = MyRegistration & { regId: string };
const toMy = (eventId: string, id: string, d: Doc & { nickname: string; members: string[]; feeYen: number }, ev: { title: string; startAt: string }): MemberRegistration => ({
  regId: id, status: d.status, nickname: d.nickname, members: d.members ?? [], partySize: d.partySize, feeYen: d.feeYen,
  offerExpiresAt: d.offerExpiresAt ?? null, reconfirm: d.reconfirm === true, event: { id: eventId, title: ev.title, startAt: ev.startAt },
});

// このイベントでの、メンバー本人の申込(取消・期限切れ以外を優先し、なければ直近の取消)。
export async function getMemberRegistration(eventId: string, memberId: string): Promise<MemberRegistration | null> {
  if (!validId(eventId) || !validId(memberId)) return null;
  const [snap, ev] = await Promise.all([regs(eventId).where("memberId", "==", memberId).get(), db().collection("events").doc(eventId).get()]);
  const parsed = eventSchema.safeParse(ev.data());
  if (!parsed.success || snap.empty) return null;
  const rows = snap.docs.map((d) => ({ id: d.id, d: d.data() as Doc & { nickname: string; members: string[]; feeYen: number } }));
  const live = rows.filter((r) => r.d.status !== "cancelled" && r.d.status !== "expired");
  const pick = (live.length ? live : rows).sort((a, b) => b.d.createdAt - a.d.createdAt)[0];
  return toMy(eventId, pick.id, pick.d, parsed.data);
}

// メンバー本人の申込の一覧(渡されたイベントのうち、申込があるもの)。
export async function listMemberRegistrations(memberId: string, events: { id: string }[]): Promise<MemberRegistration[]> {
  if (!validId(memberId)) return [];
  const out = await Promise.all(events.map((e) => getMemberRegistration(e.id, memberId).catch(() => null)));
  return out.filter((x): x is MemberRegistration => x !== null);
}

// ---- 主催者専用(呼び出し側で requireAdmin() を済ませること) ----
export type AdminOpResult = "ok" | "not_found" | "invalid_state" | "paid" | "duplicate";

// 参加者の削除(取消)。入金済みのときは拒否(先に入金を取り消す)。開始前なら、取消で空いた枠にキャンセル待ちを繰り上げる。
export async function adminCancelRegistration(eventId: string, regId: string, by: string): Promise<AdminOpResult> {
  if (!validId(eventId) || !validId(regId)) return "not_found";
  const ref = regs(eventId).doc(regId);
  const now = new Date();
  return db().runTransaction(async (tx): Promise<AdminOpResult> => {
    const event = await loadEvent(tx, eventId);
    const mine = await tx.get(ref);
    if (!event || !mine.exists) return "not_found";
    const cur = mine.data() as Doc & { paidYen?: number };
    if (cur.status === "cancelled" || cur.status === "expired") return "invalid_state";
    if ((cur.paidYen ?? 0) > 0) return "paid";
    const snap = await tx.get(regs(eventId));
    const rows = snap.docs.map((d) => toRow(d.id, d.data() as Doc));
    tx.update(ref, { status: "cancelled", offerExpiresAt: null, updatedAt: Date.now(), cancelledBy: "admin", cancelledAt: FieldValue.serverTimestamp() });
    if (new Date(event.startAt) > now) applyPatches(tx, eventId, rebalance(event.capacity, rows.map((r) => (r.id === ref.id ? { ...r, status: "cancelled" as const } : r)), new Date(event.startAt), now));
    tx.set(db().collection("events").doc(eventId).collection("audit").doc(), { at: Date.now(), by, action: "admin_cancel", regId });
    return "ok";
  });
}

// 参加者の追加。主催者の判断で、定員に関係なく「参加確定」として登録する(メンバーは1イベント1申込まで)。
export async function adminAddRegistration(eventId: string, input: { memberId?: string; nickname: string; partySize: number }, by: string): Promise<AdminOpResult> {
  if (!validId(eventId) || (input.memberId !== undefined && !validId(input.memberId))) return "not_found";
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > MAX_PARTY || input.nickname.length < 1 || input.nickname.length > 30) return "invalid_state";
  const evRef = db().collection("events").doc(eventId);
  return db().runTransaction(async (tx): Promise<AdminOpResult> => {
    const event = await loadEvent(tx, eventId);
    if (!event) return "not_found";
    const snap = await tx.get(regs(eventId));
    if (input.memberId && snap.docs.some((d) => { const x = d.data() as Doc; return x.memberId === input.memberId && x.status !== "cancelled" && x.status !== "expired"; })) return "duplicate";
    const ref = regs(eventId).doc();
    tx.create(ref, {
      nickname: input.nickname, members: Array.from({ length: input.partySize - 1 }, (_, i) => `${input.nickname}の同行者${i + 1}`), partySize: input.partySize,
      status: "confirmed", feeYen: event.feeYen, checkedIn: false, paidYen: 0, source: "admin", offerExpiresAt: null,
      createdAt: Date.now(), updatedAt: Date.now(), ...(input.memberId ? { memberId: input.memberId } : {}),
    });
    tx.set(evRef.collection("audit").doc(), { at: Date.now(), by, action: "admin_add", regId: ref.id });
    return "ok";
  });
}

// メンバー削除の前に: これから開催される申込の状況。
export async function upcomingMemberRegistrations(memberId: string): Promise<{ eventId: string; regId: string; status: RegStatus; paidYen: number }[]> {
  if (!validId(memberId)) return [];
  const evs = await db().collection("events").get();
  const upcoming = evs.docs.filter((d) => { const p = eventSchema.safeParse(d.data()); return p.success && new Date(p.data.startAt) > new Date(); });
  const out: { eventId: string; regId: string; status: RegStatus; paidYen: number }[] = [];
  await Promise.all(upcoming.map(async (e) => {
    const snap = await regs(e.id).where("memberId", "==", memberId).get();
    for (const d of snap.docs) { const x = d.data() as Doc & { paidYen?: number }; if (x.status !== "cancelled" && x.status !== "expired") out.push({ eventId: e.id, regId: d.id, status: x.status, paidYen: x.paidYen ?? 0 }); }
  }));
  return out;
}
