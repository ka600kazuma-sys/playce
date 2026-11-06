import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema, type EventInput, type PublicEvent } from "@/lib/domain/events";
import { RECONFIRM_STATUSES, needsReconfirm } from "@/lib/domain/registration";

const col = () => db().collection("events");
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

// 以下は管理者専用。呼び出し側の Server Action / ページで requireAdmin() を済ませること。
export async function listAllEvents(): Promise<PublicEvent[]> {
  const snap = await col().orderBy("startAt", "desc").limit(300).get();
  const out: PublicEvent[] = [];
  for (const d of snap.docs) {
    const p = eventSchema.safeParse(d.data());
    if (p.success) out.push({ id: d.id, ...p.data });
  }
  return out;
}

export async function getEventAny(id: string): Promise<PublicEvent | null> {
  if (!validId(id)) return null;
  const d = await col().doc(id).get();
  const p = d.exists ? eventSchema.safeParse(d.data()) : null;
  return p?.success ? { id: d.id, ...p.data } : null;
}

export type HistoryRow = { at: number; by: string; action: string; changes: Record<string, { from: unknown; to: unknown }>; reconfirmRequested?: number };
export async function listHistory(id: string) {
  if (!validId(id)) return [];
  const snap = await col().doc(id).collection("history").orderBy("at", "desc").limit(50).get();
  return snap.docs.map((d) => d.data() as HistoryRow);
}

function diff(a: Partial<EventInput>, b: EventInput) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(b) as (keyof EventInput)[]) {
    if (a[k] !== b[k]) changes[k] = { from: a[k] ?? null, to: b[k] ?? null };
  }
  return changes;
}

// 作成(定期開催の複製を含む)。各イベントに作成履歴を残す。
export async function createEvents(inputs: EventInput[], by: string): Promise<string[]> {
  const batch = db().batch();
  const ids: string[] = [];
  const at = Date.now();
  for (const input of inputs) {
    const ref = col().doc();
    ids.push(ref.id);
    batch.set(ref, input);
    batch.set(ref.collection("history").doc(), { at, by, action: "create", changes: {} });
  }
  await batch.commit();
  return ids;
}

// 更新。変更前後の差分(料金・日時・状態など)を履歴に保存する。
// 開始日時が変わった場合(延期・日程変更)は、既存の申込を維持したまま、参加継続の意思確認(reconfirm)を求める。
export async function updateEvent(id: string, input: EventInput, by: string): Promise<"ok" | "not_found"> {
  if (!validId(id)) return "not_found";
  const ref = col().doc(id);
  return db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const p = cur.exists ? eventSchema.safeParse(cur.data()) : null;
    if (!p?.success) return "not_found";
    const changes = diff(p.data, input);
    if (Object.keys(changes).length === 0) return "ok";
    const reschedule = needsReconfirm(p.data.startAt, input.startAt);
    const targets = reschedule ? (await tx.get(ref.collection("registrations"))).docs.filter((d) => RECONFIRM_STATUSES.includes((d.data() as { status: never }).status)) : [];
    tx.set(ref, input);
    for (const d of targets) tx.update(d.ref, { reconfirm: true, updatedAt: Date.now() });
    tx.set(ref.collection("history").doc(), { at: Date.now(), by, action: changes.status ? "status" : "update", changes, ...(reschedule ? { reconfirmRequested: targets.length } : {}) });
    return "ok";
  });
}
