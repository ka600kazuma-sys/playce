import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { eventSchema, type EventInput } from "@/lib/domain/events";
import {
  decideInitialStatus, hashSecret, isTokenShape, newToken, rebalance,
  type RegPatch, type RegRow, type RegStatus,
} from "@/lib/domain/registration";

export type ApplyResult =
  | { ok: true; token: string; status: RegStatus }
  | { ok: false; code: "not_found" | "closed" | "duplicate" };

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

type Doc = { status: RegStatus; partySize: number; createdAt: number; offerExpiresAt: number | null; browserHash?: string; reconfirm?: boolean };
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
    const dup = docs.some(({ d }) => d.browserHash === browserHash && d.status !== "cancelled" && d.status !== "expired");
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
export async function changeRegistration(
  eventId: string, token: string, change: Change, edit?: { nickname: string; members: string[] },
): Promise<ChangeResult> {
  if (!validId(eventId) || !isTokenShape(token)) return "not_found";
  const ref = regs(eventId).doc(hashSecret(token));
  const now = new Date();
  return db().runTransaction(async (tx): Promise<ChangeResult> => {
    const event = await loadEvent(tx, eventId);
    const mine = await tx.get(ref);
    if (!event || !mine.exists) return "not_found";
    if (new Date(event.startAt) <= now) return "closed";
    const cur = mine.data() as Doc;
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
