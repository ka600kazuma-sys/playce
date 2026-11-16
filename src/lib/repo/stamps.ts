import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import {
  DEFAULT_TIERS, STAMP_SPORTS, TAP_AFTER_MS, decideTap, discountFor, isStampSport, parseTiers, tagToken, tapWindow, verifyTagToken, visitIndex,
  type AllTiers, type StampSport, type TapResult, type Tiers,
} from "@/lib/domain/stamps";
import { formSecret } from "@/lib/repo/formtoken";
import { listPublicEvents } from "@/lib/repo/events";
import { getMemberRegistration } from "@/lib/repo/registrations";

// スタンプカード。保存先(すべてサーバー(Admin SDK)経由のみ。firestore.rules は全拒否のまま):
//   stampCards/{メンバーID}_{競技}        … { memberId, sport, enabled, points(0〜5), createdAt, updatedAt, enabledAt? } 本人と主催者だけが読む
//   events/{イベントID}/stampTaps/{メンバーID} … タグをかざした記録(1イベント1人1件。作成は1回だけ=二重付与の防止)
//   stampConfig/default                   … { tiers: 割引額, updatedAt, updatedBy } (+ history サブコレクション)
//   stampTags/{イベントID}                … { version }(タグURLの版。再発行で+1)
// メンバーIDは、必ず呼び出し側がログインのセッションから取り出したものを渡す(画面・リクエストの値は使わない)。
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const cardRef = (memberId: string, sport: StampSport) => db().collection("stampCards").doc(`${memberId}_${sport}`);
const eventRef = (eventId: string) => db().collection("events").doc(eventId);
const tapRef = (eventId: string, memberId: string) => eventRef(eventId).collection("stampTaps").doc(memberId);
const configRef = () => db().collection("stampConfig").doc("default");
const tagRef = (eventId: string) => db().collection("stampTags").doc(eventId);

export type Card = { enabled: boolean; points: number };
const cardOf = (d: FirebaseFirestore.DocumentData | undefined): Card => {
  const p = d?.points;
  return { enabled: d?.enabled === true, points: Number.isInteger(p) && p >= 0 && p <= 5 ? p : 0 };
};

// ---- 割引額の設定 ----
export async function getTiers(): Promise<AllTiers> {
  try { return parseTiers((await configRef().get()).data()?.tiers) ?? DEFAULT_TIERS; } catch { return DEFAULT_TIERS; }
}
export async function setTiers(input: unknown, by: string): Promise<"ok" | "invalid"> {
  const tiers = parseTiers(input);
  if (!tiers) return "invalid";
  const before = await getTiers();
  const batch = db().batch();
  batch.set(configRef(), { tiers, updatedAt: Date.now(), updatedBy: by });
  batch.set(configRef().collection("history").doc(), { at: Date.now(), by, before, after: tiers });
  await batch.commit();
  return "ok";
}

// 料金を変える処理用: 設定が読めない・壊れているときは、既定値で進めずに失敗させる(設定した額と違う割引にならないように)。
// 設定がまだ無い(一度も保存していない)ときだけ、既定値を使う。
const tiersFromSnap = (snap: FirebaseFirestore.DocumentSnapshot): AllTiers => {
  if (!snap.exists) return DEFAULT_TIERS;
  const t = parseTiers(snap.data()?.tiers);
  if (!t) throw new Error("stampConfig is invalid");
  return t;
};

// ---- カード(貯めるかどうか・ポイント) ----
export async function getCards(memberId: string): Promise<Record<StampSport, Card>> {
  const out = { badminton: { enabled: false, points: 0 }, volleyball: { enabled: false, points: 0 } } as Record<StampSport, Card>;
  if (!validId(memberId)) return out;
  const snaps = await db().getAll(...STAMP_SPORTS.map((s) => cardRef(memberId, s)));
  STAMP_SPORTS.forEach((s, i) => { out[s] = cardOf(snaps[i].data()); });
  return out;
}

// ONにする/OFFにする。OFFにしても、これまでのポイントは残す。ONにする前の出席は、さかのぼって付かない。
export async function setEnabled(memberId: string, sport: StampSport, enabled: boolean): Promise<boolean> {
  if (!validId(memberId) || !isStampSport(sport)) return false;
  const ref = cardRef(memberId, sport);
  return db().runTransaction(async (tx) => {
    // 削除されたメンバーのカードを作り直さない(削除と同時に設定が来ても残らないように)。
    const [s, mem] = await Promise.all([tx.get(ref), tx.get(db().collection("members").doc(memberId))]);
    if (!mem.exists) return false;
    const now = Date.now();
    if (!s.exists) tx.create(ref, { memberId, sport, enabled, points: 0, createdAt: now, updatedAt: now, ...(enabled ? { enabledAt: now } : {}) });
    else tx.update(ref, { enabled, updatedAt: now, ...(enabled && s.data()?.enabled !== true ? { enabledAt: now } : {}) });
    return true;
  });
}

// ---- タグ(URLの版と検証) ----
export async function getTagVersion(eventId: string): Promise<number> {
  if (!validId(eventId)) return 1;
  const v = (await tagRef(eventId).get()).data()?.version;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}
export async function currentTagToken(eventId: string): Promise<string> {
  const secret = formSecret();
  return secret ? tagToken(secret, eventId, await getTagVersion(eventId)) : "";
}
export async function verifyTag(eventId: string, token: string): Promise<boolean> {
  const secret = formSecret();
  if (!secret || !validId(eventId)) return false;
  return verifyTagToken(secret, eventId, await getTagVersion(eventId), token);
}
// 再発行(主催者専用。呼び出し側で requireAdmin() を済ませること)。古いURL・タグは使えなくなる。
export async function bumpTagVersion(eventId: string, by: string): Promise<number | null> {
  if (!validId(eventId)) return null;
  return db().runTransaction(async (tx) => {
    const e = await tx.get(eventRef(eventId));
    if (!e.exists) return null;
    const s = await tx.get(tagRef(eventId));
    const cur = Number.isInteger(s.data()?.version) && s.data()!.version >= 1 ? (s.data()!.version as number) : 1;
    tx.set(tagRef(eventId), { version: cur + 1, updatedAt: Date.now(), updatedBy: by });
    tx.set(eventRef(eventId).collection("audit").doc(), { at: Date.now(), by, action: "stamp_tag_reissue", from: cur, to: cur + 1 });
    return cur + 1;
  });
}

// ---- タグをかざす(ポイントの付与) ----
export type TapOutcome = { result: TapResult; sport?: StampSport; points?: number };
// token: タグURLの署名。付与と同じトランザクションで、現行の版かどうかを確認する(再発行との競合で、古いURLが通らないように)。
export async function tap(memberId: string, eventId: string, token: string, now = Date.now()): Promise<TapOutcome> {
  if (!validId(memberId) || !validId(eventId)) return { result: "invalid" };
  const secret = formSecret();
  return db().runTransaction(async (tx): Promise<TapOutcome> => {
    const tagSnap = await tx.get(tagRef(eventId));
    const ver = Number.isInteger(tagSnap.data()?.version) && tagSnap.data()!.version >= 1 ? (tagSnap.data()!.version as number) : 1;
    if (!secret || !verifyTagToken(secret, eventId, ver, token)) return { result: "bad" };
    const evSnap = await tx.get(eventRef(eventId));
    const parsed = eventSchema.safeParse(evSnap.data());
    if (!parsed.success || parsed.data.status !== "published") return { result: "invalid" };
    const ev = parsed.data;
    if (!isStampSport(ev.sport)) return { result: "unsupported" };
    const [mem, regs, card, done] = await Promise.all([
      tx.get(db().collection("members").doc(memberId)),
      tx.get(eventRef(eventId).collection("registrations").where("memberId", "==", memberId)),
      tx.get(cardRef(memberId, ev.sport)),
      tx.get(tapRef(eventId, memberId)),
    ]);
    if (!mem.exists) return { result: "invalid" };
    const confirmed = regs.docs.filter((d) => d.data().status === "confirmed").sort((a, b) => (b.data().createdAt ?? 0) - (a.data().createdAt ?? 0))[0];
    const c = cardOf(card.data());
    const d = decideTap({
      sportSupported: true, enabled: c.enabled, hasConfirmedRegistration: !!confirmed, window: tapWindow(ev, now), alreadyTapped: done.exists, points: c.points,
    });
    if (d.result !== "ok") return { result: d.result, sport: ev.sport, points: c.points };
    tx.create(tapRef(eventId, memberId), { memberId, eventId, sport: ev.sport, regId: confirmed.id, at: now, pointsBefore: c.points, pointsAfter: d.pointsAfter });
    tx.update(cardRef(memberId, ev.sport), { points: d.pointsAfter, lastTapAt: now, updatedAt: now });
    return { result: "ok", sport: ev.sport, points: d.pointsAfter };
  });
}

// ---- チケットの表示用データ(本人の分だけ) ----
export type TicketView = {
  sport: StampSport; enabled: boolean; points: number; tiers: Tiers;
  event: { id: string; title: string; startAt: string; endAt: string; venue: string } | null;
  feeYen: number; partySize: number; tapped: boolean;
  // feeYen は割引前の参加費(申込時の料金)。appliedDiscountYen は、受付で適用済みのスタンプ割引。tapPoints は、このイベントでかざしたときのポイント。
  appliedDiscountYen: number | null; tapPoints: number | null;
};
export async function getTickets(memberId: string, now = Date.now()): Promise<TicketView[]> {
  const [cards, tiers, events] = await Promise.all([getCards(memberId), getTiers(), listPublicEvents().catch(() => [])]);
  return Promise.all(STAMP_SPORTS.map(async (sport): Promise<TicketView> => {
    const base: TicketView = { sport, enabled: cards[sport].enabled, points: cards[sport].points, tiers: tiers[sport], event: null, feeYen: 0, partySize: 1, tapped: false, appliedDiscountYen: null, tapPoints: null };
    // その競技の、これから(または終了後6時間以内)の公開イベントのうち、参加確定の申込がある、いちばん近いもの。
    // その競技の、これから(または終了後6時間以内)の公開イベントのうち、90日先までを、申込の有無だけ調べる(1イベント1回の問い合わせ)。
    // 開始が近い順に並んでいるので、参加確定の申込がある最初のものが、いちばん近い開催。
    const horizon = now + 90 * 864e5;
    const upcoming = events.filter((e) => e.sport === sport && e.status === "published" && new Date(e.endAt).getTime() + TAP_AFTER_MS >= now && new Date(e.startAt).getTime() <= horizon).slice(0, 60);
    const mine = await Promise.all(upcoming.map(async (e) => {
      const snap = await eventRef(e.id).collection("registrations").where("memberId", "==", memberId).get().catch(() => null);
      return snap?.docs.filter((d) => d.data().status === "confirmed").sort((x, y) => (y.data().createdAt ?? 0) - (x.data().createdAt ?? 0))[0] ?? null;
    }));
    const i = mine.findIndex((d) => d !== null);
    if (i < 0) return base;
    const e = upcoming[i], d = mine[i]!.data();
    const tapDoc = (await tapRef(e.id, memberId).get()).data();
    return {
      ...base, event: { id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, venue: e.venue },
      feeYen: (Number.isInteger(d.baseFeeYen) ? d.baseFeeYen : d.feeYen) as number, partySize: d.partySize as number, tapped: !!tapDoc,
      appliedDiscountYen: Number.isInteger(d.stampDiscountYen) ? (d.stampDiscountYen as number) : null,
      tapPoints: Number.isInteger(tapDoc?.pointsAfter) ? (tapDoc!.pointsAfter as number) : null,
    };
  }));
}

// ---- 主催者専用(呼び出し側で requireAdmin() を済ませること) ----
export type AdminStampEvent = { id: string; title: string; sport: StampSport; startAt: string; venue: string; version: number; token: string; taps: number };
export async function adminStampEvents(now = Date.now()): Promise<AdminStampEvent[]> {
  const events = (await listPublicEvents()).filter((e) => isStampSport(e.sport) && e.status === "published" && new Date(e.endAt).getTime() >= now - 14 * 864e5);
  return Promise.all(events.slice(0, 30).map(async (e) => {
    const [version, cnt] = await Promise.all([getTagVersion(e.id), eventRef(e.id).collection("stampTaps").count().get()]);
    const secret = formSecret();
    return { id: e.id, title: e.title, sport: e.sport as StampSport, startAt: e.startAt, venue: e.venue, version, token: secret ? tagToken(secret, e.id, version) : "", taps: cnt.data().count };
  }));
}

export type DiscountInfo = { enabled: boolean; points: number; tapped: boolean; index: number; discountYen: number; applied: number | null };
// 受付画面用: このイベントの、メンバーに紐づく参加確定の申込ごとの、スタンプ割引の状況。
export async function stampDiscounts(eventId: string): Promise<Record<string, DiscountInfo>> {
  if (!validId(eventId)) return {};
  const evSnap = await eventRef(eventId).get();
  const parsed = eventSchema.safeParse(evSnap.data());
  if (!parsed.success || !isStampSport(parsed.data.sport)) return {};
  const sport = parsed.data.sport, tiers = (await getTiers())[sport];
  const regs = (await eventRef(eventId).collection("registrations").get()).docs.filter((d) => d.data().status === "confirmed" && typeof d.data().memberId === "string");
  if (!regs.length) return {};
  const ids = regs.map((d) => d.data().memberId as string);
  const [cards, taps] = await Promise.all([db().getAll(...ids.map((m) => cardRef(m, sport))), db().getAll(...ids.map((m) => tapRef(eventId, m)))]);
  const out: Record<string, DiscountInfo> = {};
  regs.forEach((r, i) => {
    const c = cardOf(cards[i].data()), tapped = taps[i].exists;
    // かざし済みなら、そのイベントの記録(pointsAfter)で判定する(あとの別イベントのポイントに影響されない)。
    const index = visitIndex(tapped && Number.isInteger(taps[i].data()?.pointsAfter) ? (taps[i].data()!.pointsAfter as number) : c.points, tapped), fee = (r.data().baseFeeYen ?? r.data().feeYen) as number;
    const applied = Number.isInteger(r.data().stampDiscountYen) ? (r.data().stampDiscountYen as number) : null;
    out[r.id] = { enabled: c.enabled, points: c.points, tapped, index, discountYen: c.enabled ? discountFor(index, tiers, fee) : 0, applied };
  });
  return out;
}

export type ApplyResult = "ok" | "not_found" | "closed" | "no_discount" | "already" | "group" | "paid" | "off";
// スタンプ割引を、その申込の参加費に反映する(1人分の申込だけ。金額はサーバーで計算し直す。二重適用しない)。
export async function applyStampDiscount(eventId: string, regId: string, by: string): Promise<ApplyResult> {
  if (!validId(eventId) || !validId(regId)) return "not_found";
  const regRef = eventRef(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx): Promise<ApplyResult> => {
    const [evSnap, regSnap, closed, cfgSnap] = await Promise.all([tx.get(eventRef(eventId)), tx.get(regRef), tx.get(db().collection("accounting").doc(eventId)), tx.get(configRef())]);
    const parsed = eventSchema.safeParse(evSnap.data());
    const r = regSnap.data();
    if (!parsed.success || !isStampSport(parsed.data.sport) || !regSnap.exists || !r || r.status !== "confirmed" || typeof r.memberId !== "string") return "not_found";
    if (closed.exists && closed.data()?.closed === true) return "closed";
    if (Number.isInteger(r.stampDiscountYen)) return "already";
    if (r.partySize !== 1) return "group";
    const sport = parsed.data.sport;
    const tiers = tiersFromSnap(cfgSnap); // 読めない・壊れているときは、例外で中止(料金を変えない)
    const [cardSnap, tapSnap] = await Promise.all([tx.get(cardRef(r.memberId, sport)), tx.get(tapRef(eventId, r.memberId))]);
    const c = cardOf(cardSnap.data());
    if (!c.enabled) return "off";
    const index = visitIndex(tapSnap.exists && Number.isInteger(tapSnap.data()?.pointsAfter) ? (tapSnap.data()!.pointsAfter as number) : c.points, tapSnap.exists), base = r.feeYen as number;
    const discount = discountFor(index, tiers[sport], base);
    if (discount <= 0) return "no_discount";
    const fee = base - discount;
    if (fee * r.partySize < (r.paidYen ?? 0)) return "paid";
    tx.update(regRef, { feeYen: fee, baseFeeYen: base, stampDiscountYen: discount, stampDiscountIndex: index, updatedAt: Date.now() });
    tx.set(eventRef(eventId).collection("audit").doc(), { at: Date.now(), by, action: "stamp_discount", regId, from: base, to: fee, index, discountYen: discount });
    return "ok";
  });
}
