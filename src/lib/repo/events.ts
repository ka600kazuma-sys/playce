import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema, PUBLIC_STATUSES, type PublicEvent } from "@/lib/domain/events";

// 公開カレンダー用。公開状態のイベントだけを、検証済みの公開フィールドで返す。
export async function listPublicEvents(): Promise<PublicEvent[]> {
  // 実環境の Firestore では「status の in 条件 + startAt の並べ替え」に複合インデックスが必要になる。
  // 公開イベントの件数は少ないため、並べ替えはアプリ側で行い、インデックスへの依存をなくす。
  const snap = await db().collection("events").where("status", "in", PUBLIC_STATUSES).get();
  const out: PublicEvent[] = [];
  for (const doc of snap.docs) {
    const parsed = eventSchema.safeParse(doc.data());
    if (parsed.success) out.push({ id: doc.id, ...parsed.data });
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export async function getPublicEvent(id: string): Promise<PublicEvent | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const doc = await db().collection("events").doc(id).get();
  if (!doc.exists) return null;
  const parsed = eventSchema.safeParse(doc.data());
  if (!parsed.success || !PUBLIC_STATUSES.includes(parsed.data.status)) return null;
  return { id: doc.id, ...parsed.data };
}
