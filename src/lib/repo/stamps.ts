import "server-only";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import {
  DEFAULT_TIERS, STAMP_SPORTS, TAP_AFTER_MS, TAP_LOOKBACK_MS, isQrCount, qrToken, verifyQrToken, decideTap, discountFor, isStampSport, parseTiers, tagToken, tapWindow, verifyTagToken, visitIndex,
  type AllTiers, type StampSport, type TapResult, type Tiers,
} from "@/lib/domain/stamps";
import { DEFAULT_LAP_REWARDS, cardStateOf, parseLapRewards, planAward, totalOf, type CouponPlan, type LapRewards } from "@/lib/domain/stampcard2";
import { formSecret } from "@/lib/repo/formtoken";
import { listPublicEvents } from "@/lib/repo/events";

// スタンプカード。保存先(すべてサーバー(Admin SDK)経由のみ。firestore.rules は全拒否のまま):
//   stampCards/{メンバーID}_{競技}        … { memberId, sport, enabled, points(0〜5), createdAt, updatedAt, enabledAt? } 本人と主催者だけが読む
//   events/{イベントID}/stampTaps/{メンバーID} … タグをかざした記録(1イベント1人1件。作成は1回だけ=二重付与の防止)
//   stampConfig/default                   … { tiers: 割引額, updatedAt, updatedBy } (+ history サブコレクション)
//   stampTags/{競技}                      … { version }(タグURLの版。競技ごとに1枚。再発行で+1。history サブコレクションに履歴)
// メンバーIDは、必ず呼び出し側がログインのセッションから取り出したものを渡す(画面・リクエストの値は使わない)。
export const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const cardRef = (memberId: string, sport: StampSport) => db().collection("stampCards").doc(`${memberId}_${sport}`);
export const eventRef = (eventId: string) => db().collection("events").doc(eventId);
export const tapRef = (eventId: string, memberId: string) => eventRef(eventId).collection("stampTaps").doc(memberId);
export const configRef = () => db().collection("stampConfig").doc("default");
const tagRef = (sport: StampSport) => db().collection("stampTags").doc(sport);

// points は周内(0〜4)、lap は1始まり。旧カード(lapなし)は cardStateOf で読み替える。
export type Card = { enabled: boolean; points: number; lap: number };
const cardOf = (d: FirebaseFirestore.DocumentData | undefined): Card => {
  const s = cardStateOf(d);
  return { enabled: d?.enabled === true, points: s.points, lap: s.lap };
};

// ---- 周回の特典(クーポン)。2026-11: 割引は直接値引きをやめ、クーポン発行だけにした(ユーザー決定) ----
// coupons/{クーポンID} … { memberId, sport, kind: "discount"|"free", yen, lap, threshold, issuedAt, reason, sourceKey, eventId?, status: "active"|"used"|"cancelled", usedAt, usedEventId, expiresAt }
// クーポンIDは「付与の元+周+段階」で決まる → 同じ付与の再送で、2枚目は作れない(tx.create)。有効期限・併用・当日使用の可否は未確定のため、設定値を持たず null(期限なし)。
export const couponRef = (id: string) => db().collection("coupons").doc(id);
export const rewardsFromSnap = (snap: FirebaseFirestore.DocumentSnapshot): LapRewards => {
  const v = snap.data()?.lapRewards;
  if (v === undefined) return DEFAULT_LAP_REWARDS;
  const r = parseLapRewards(v);
  if (!r) throw new Error("stampConfig.lapRewards is invalid"); // 読めない・壊れているときは、既定値で進めず失敗させる
  return r;
};
// クーポンの運用設定(未確定事項は、管理者設定で切り替える。初期値は安全側): sameDay=発行されたイベントの当日から使えるか(初期: 使えない=次回以降) / expiryDays=有効日数(初期: なし)。
export type CouponPolicy = { sameDay: boolean; expiryDays: number | null };
export const policyFromSnap = (snap: FirebaseFirestore.DocumentSnapshot): CouponPolicy => {
  const c = snap.data()?.couponPolicy as { sameDay?: unknown; expiryDays?: unknown } | undefined;
  const d = c?.expiryDays;
  return { sameDay: c?.sameDay === true, expiryDays: Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 3650 ? (d as number) : null };
};
// 自動発行のクーポンIDは「会員・競技・周・段階」で決まる(付与の元に依存しない)。同じ到達で2枚目は作れず、使用済みの特典を、ポイントを戻して再到達しても再発行しない。
// ポイント取り消しで取り消された未使用の券だけは、再到達時に再発行する(管理者が個別に取り消した券・使用済み・未使用で残っている券は、再発行しない)。ID長は固定(42文字)。
const couponKey = (m: string, sp: string, lap: number, th: number) => `c_${createHash("sha256").update(`${m}|${sp}|${lap}|${th}`).digest("hex").slice(0, 40)}`;
export type PreparedCoupon = CouponPlan & { mode: "create" | "reissue" };
// 読み取りは、最初の書き込みより前に呼ぶこと(トランザクションの制約)。
export async function prepCoupons(tx: FirebaseFirestore.Transaction, memberId: string, sport: StampSport, coupons: CouponPlan[]): Promise<PreparedCoupon[]> {
  const ids = coupons.map((c) => couponKey(memberId, sport, c.lap, c.threshold));
  const snaps = await Promise.all(ids.map((id) => tx.get(couponRef(id))));
  const out: PreparedCoupon[] = [];
  coupons.forEach((c, i) => {
    const d = snaps[i].data();
    if (!snaps[i].exists) out.push({ ...c, id: ids[i], mode: "create" });
    else if (d?.status === "cancelled" && typeof d.cancelReason === "string" && d.cancelReason.startsWith("ポイント取り消し")) out.push({ ...c, id: ids[i], mode: "reissue" });
  });
  return out;
}
export function writeCoupons(tx: FirebaseFirestore.Transaction, cfg: FirebaseFirestore.DocumentSnapshot, p: { memberId: string; sport: StampSport; eventId: string | null; sourceKey: string; coupons: PreparedCoupon[]; now: number; reason: string }) {
  const pol = policyFromSnap(cfg);
  for (const c of p.coupons) {
    (c.mode === "reissue" ? (ref: FirebaseFirestore.DocumentReference, d: FirebaseFirestore.DocumentData) => tx.set(ref, d) : (ref: FirebaseFirestore.DocumentReference, d: FirebaseFirestore.DocumentData) => tx.create(ref, d))(couponRef(c.id), {
      memberId: p.memberId, sport: p.sport, kind: c.reward.kind, yen: c.reward.kind === "discount" ? c.reward.yen : 0, lap: c.lap, threshold: c.threshold,
      issuedAt: p.now, reason: `${p.reason}(${c.lap}周目 ${c.threshold}ポイント到達)`, sourceKey: p.sourceKey, eventId: p.eventId,
      status: "active", usedAt: null, usedEventId: null, expiresAt: pol.expiryDays ? p.now + pol.expiryDays * 864e5 : null,
    });
  }
}

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
  const out = { badminton: { enabled: false, points: 0, lap: 1 }, volleyball: { enabled: false, points: 0, lap: 1 } } as Record<StampSport, Card>;
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

// ---- タグ(競技ごとに1枚。URLの版と検証) ----
// タグは、競技ごと(バドミントン用・バレーボール用)に、毎回同じものを使う。かざしたとき、その人が参加確定で申し込んでいる、いま開催中のイベントを探して付与する。
export async function getTagVersion(sport: string): Promise<number> {
  if (!isStampSport(sport)) return 1;
  const v = (await tagRef(sport).get()).data()?.version;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}
export async function currentTagToken(sport: string): Promise<string> {
  const secret = formSecret();
  return secret && isStampSport(sport) ? tagToken(secret, sport, await getTagVersion(sport)) : "";
}
export async function verifyTag(sport: string, token: string): Promise<boolean> {
  const secret = formSecret();
  if (!secret || !isStampSport(sport)) return false;
  return verifyTagToken(secret, sport, await getTagVersion(sport), token);
}
// 再発行(主催者専用。呼び出し側で requireAdmin() を済ませること)。古いURL・タグ・QRは使えなくなる。
export async function bumpTagVersion(sport: string, by: string): Promise<number | null> {
  if (!isStampSport(sport)) return null;
  return db().runTransaction(async (tx) => {
    const s = await tx.get(tagRef(sport));
    const cur = Number.isInteger(s.data()?.version) && s.data()!.version >= 1 ? (s.data()!.version as number) : 1;
    tx.set(tagRef(sport), { version: cur + 1, updatedAt: Date.now(), updatedBy: by });
    tx.set(tagRef(sport).collection("history").doc(), { at: Date.now(), by, action: "reissue", from: cur, to: cur + 1 });
    return cur + 1;
  });
}

// ---- タグをかざす(ポイントの付与) ----
export type TapOutcome = { result: TapResult; sport?: StampSport; points?: number; count?: number };
// 1つのイベントへの付与。token: 競技のタグの署名。付与と同じトランザクションで、現行の版かどうかを確認する(再発行との競合で、古いURLが通らないように)。
export async function tap(memberId: string, eventId: string, token: string, now = Date.now()): Promise<TapOutcome> {
  if (!validId(memberId) || !validId(eventId)) return { result: "invalid" };
  const secret = formSecret();
  return db().runTransaction(async (tx): Promise<TapOutcome> => {
    const evSnap = await tx.get(eventRef(eventId));
    const parsed = eventSchema.safeParse(evSnap.data());
    if (!parsed.success || parsed.data.status !== "published") return { result: "invalid" };
    const ev = parsed.data;
    if (!isStampSport(ev.sport)) return { result: "unsupported" };
    const [tagSnap, mem, regs, card, done, cfg] = await Promise.all([
      tx.get(tagRef(ev.sport)),
      tx.get(db().collection("members").doc(memberId)),
      tx.get(eventRef(eventId).collection("registrations").where("memberId", "==", memberId)),
      tx.get(cardRef(memberId, ev.sport)),
      tx.get(tapRef(eventId, memberId)),
      tx.get(configRef()),
    ]);
    const ver = Number.isInteger(tagSnap.data()?.version) && tagSnap.data()!.version >= 1 ? (tagSnap.data()!.version as number) : 1;
    if (!secret || !verifyTagToken(secret, ev.sport, ver, token)) return { result: "bad" };
    if (!mem.exists) return { result: "invalid" };
    const confirmed = regs.docs.filter((d) => d.data().status === "confirmed").sort((a, b) => (b.data().createdAt ?? 0) - (a.data().createdAt ?? 0))[0];
    const c = cardOf(card.data());
    const d = decideTap({
      sportSupported: true, enabled: c.enabled, hasConfirmedRegistration: !!confirmed, window: tapWindow(ev, now), alreadyTapped: done.exists, points: c.points,
    });
    if (d.result !== "ok") return { result: d.result, sport: ev.sport, points: c.points };
    const sourceKey = `visit_${eventId}_${memberId}`, earned = ev.stampMultiplier;
    const plan = planAward(card.data(), earned, sourceKey, rewardsFromSnap(cfg));
    const cps = await prepCoupons(tx, memberId, ev.sport, plan.coupons);
    tx.create(tapRef(eventId, memberId), { memberId, eventId, sport: ev.sport, regId: confirmed.id, at: now, via: "tag", earned, totalBefore: totalOf(plan.before), pointsAfter: plan.after.points, lapAfter: plan.after.lap });
    tx.update(cardRef(memberId, ev.sport), { lap: plan.after.lap, points: plan.after.points, model: 2, visits: FieldValue.increment(1), lastTapAt: now, updatedAt: now });
    writeCoupons(tx, cfg, { memberId, sport: ev.sport, eventId, sourceKey, coupons: cps, now, reason: "参加スタンプ" });
    return { result: "ok", sport: ev.sport, points: plan.after.points, count: earned };
  });
}

// 付け忘れ用のQR(1個・2個)。主催者が会場で見せたQRを読んだ人に、そのイベントのスタンプを付ける(1イベント1回。NFCで付いていたら「取得済み」)。
// アプリをまだ使っていない人にも付けられるよう、申込の有無は問わない(読み取り前に、ログイン・新規登録が必要)。QRを読む操作を、その競技のスタンプカードをONにする意思とみなし、OFFならONにする。
// 時間の範囲は、タグと同じ(開始の3時間前〜終了から90日)。署名は「イベント+個数」。
export async function tapQr(memberId: string, eventId: string, count: number, token: string, now = Date.now()): Promise<TapOutcome> {
  if (!validId(memberId) || !validId(eventId) || !isQrCount(count)) return { result: "invalid" };
  const secret = formSecret();
  if (!secret || !verifyQrToken(secret, eventId, count, token)) return { result: "bad" };
  return db().runTransaction(async (tx): Promise<TapOutcome> => {
    const evSnap = await tx.get(eventRef(eventId));
    const parsed = eventSchema.safeParse(evSnap.data());
    if (!parsed.success || parsed.data.status !== "published") return { result: "invalid" };
    const ev = parsed.data;
    if (!isStampSport(ev.sport)) return { result: "unsupported" };
    const [mem, regs, card, done, cfg] = await Promise.all([
      tx.get(db().collection("members").doc(memberId)),
      tx.get(eventRef(eventId).collection("registrations").where("memberId", "==", memberId)),
      tx.get(cardRef(memberId, ev.sport)),
      tx.get(tapRef(eventId, memberId)),
      tx.get(configRef()),
    ]);
    if (!mem.exists) return { result: "invalid" };
    const confirmed = regs.docs.filter((d) => d.data().status === "confirmed").sort((a, b) => (b.data().createdAt ?? 0) - (a.data().createdAt ?? 0))[0];
    const c = cardOf(card.data());
    const d = decideTap({ sportSupported: true, enabled: true, hasConfirmedRegistration: true, window: tapWindow(ev, now), alreadyTapped: done.exists, points: c.points });
    if (d.result !== "ok") return { result: d.result, sport: ev.sport, points: c.points };
    const sourceKey = `visit_${eventId}_${memberId}`, earned = count * ev.stampMultiplier; // 倍率はQRの個数にも掛ける(前提・要確認)
    const plan = planAward(card.data(), earned, sourceKey, rewardsFromSnap(cfg));
    const cps = await prepCoupons(tx, memberId, ev.sport, plan.coupons);
    tx.create(tapRef(eventId, memberId), { memberId, eventId, sport: ev.sport, regId: confirmed?.id ?? null, at: now, totalBefore: totalOf(plan.before), pointsAfter: plan.after.points, lapAfter: plan.after.lap, count, earned, via: "qr" });
    const fields = { lap: plan.after.lap, points: plan.after.points, model: 2, visits: FieldValue.increment(1), lastTapAt: now, updatedAt: now };
    if (card.exists) tx.update(cardRef(memberId, ev.sport), { ...fields, ...(c.enabled ? {} : { enabled: true, enabledAt: now }) });
    else tx.create(cardRef(memberId, ev.sport), { memberId, sport: ev.sport, enabled: true, enabledAt: now, ...fields, createdAt: now });
    writeCoupons(tx, cfg, { memberId, sport: ev.sport, eventId, sourceKey, coupons: cps, now, reason: "参加スタンプ(付け忘れQR)" });
    return { result: "ok", sport: ev.sport, points: plan.after.points, count: earned };
  });
}

// 競技のタグをかざしたとき: その人が参加確定で申し込んでいる、いま開催中(タグを読める時間内)のイベントを探して付与する。
// 開催中のイベントがなければ、まだ先(early)・終わった(late)・申込なし(noreg)を返す。同じ日に複数あるときは、開始の早い順に、まだ付いていないものへ付ける。
const DAY = 864e5;
export async function tapBySport(memberId: string, sport: string, token: string, now = Date.now()): Promise<TapOutcome> {
  if (!validId(memberId) || !isStampSport(sport)) return { result: "invalid" };
  if (!(await verifyTag(sport, token))) return { result: "bad", sport };
  // 調べるのは、開始が14日先まで・終了から90日前まで(付け忘れの後づけ)のイベント。
  // 問い合わせの数を抑えるため、いまに近い順に80件まで(開催中のものは、いまにいちばん近いので、落ちない)。
  const events = (await listPublicEvents()).filter((e) => e.sport === sport && e.status === "published"
    && new Date(e.startAt).getTime() <= now + 14 * DAY && new Date(e.endAt).getTime() + TAP_LOOKBACK_MS >= now)
    .sort((a, b) => Math.abs(new Date(a.startAt).getTime() - now) - Math.abs(new Date(b.startAt).getTime() - now)).slice(0, 80);
  // 申込の読み取りに失敗したら、付与先を決められないので、そのまま失敗させる(別のイベントへ付けない)。
  const registered = (await Promise.all(events.map(async (e) => {
    const snap = await eventRef(e.id).collection("registrations").where("memberId", "==", memberId).get();
    return snap.docs.some((d) => d.data().status === "confirmed") ? e : null;
  }))).filter((e): e is NonNullable<typeof e> => e !== null);
  // 付ける順: 開催中(終了6時間以内・開始3時間前から)を開始の早い順に、そのあと、過去のイベントを新しい順に(付け忘れの後づけ)。
  const isCurrent = (e: { endAt: string }) => new Date(e.endAt).getTime() + TAP_AFTER_MS >= now;
  const open = registered.filter((e) => tapWindow(e, now) === "open").sort((a, b) => {
    const ca = isCurrent(a), cb = isCurrent(b);
    if (ca !== cb) return ca ? -1 : 1;
    return ca ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt);
  });
  let last: TapOutcome | null = null;
  for (const e of open) {
    const r = await tap(memberId, e.id, token, now);
    if (r.result !== "already") return r;
    last = r;
  }
  if (last) return last; // 開催中のイベントは、すべて取得済み
  if (registered.some((e) => tapWindow(e, now) === "early")) return { result: "early", sport };
  if (registered.some((e) => tapWindow(e, now) === "late")) return { result: "late", sport };
  return { result: "noreg", sport };
}

// ---- チケットの表示用データ(本人の分だけ) ----
export type TicketView = {
  sport: StampSport; enabled: boolean; points: number; lap: number; rewards: LapRewards;
  event: { id: string; title: string; startAt: string; endAt: string; venue: string } | null;
  feeYen: number; partySize: number; tapped: boolean;
  // feeYen は参加費(申込時の料金)。tapPoints は、このイベントでかざしたときの周内ポイント。
  tapPoints: number | null;
};
export async function getTickets(memberId: string, now = Date.now()): Promise<TicketView[]> {
  const [cards, rewards, events] = await Promise.all([getCards(memberId), configRef().get().then(rewardsFromSnap).catch(() => DEFAULT_LAP_REWARDS), listPublicEvents().catch(() => [])]);
  return Promise.all(STAMP_SPORTS.map(async (sport): Promise<TicketView> => {
    const base: TicketView = { sport, enabled: cards[sport].enabled, points: cards[sport].points, lap: cards[sport].lap, rewards, event: null, feeYen: 0, partySize: 1, tapped: false, tapPoints: null };
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
      feeYen: d.feeYen as number, // 実際の請求額(クーポン適用後は、引かれた額) partySize: d.partySize as number, tapped: !!tapDoc,
      tapPoints: Number.isInteger(tapDoc?.pointsAfter) ? (tapDoc!.pointsAfter as number) : null,
    };
  }));
}

// ---- 主催者専用(呼び出し側で requireAdmin() を済ませること) ----
export type AdminStampEvent = { id: string; title: string; sport: StampSport; startAt: string; venue: string; taps: number };
export async function adminStampEvents(now = Date.now()): Promise<AdminStampEvent[]> {
  const events = (await listPublicEvents()).filter((e) => isStampSport(e.sport) && e.status === "published" && new Date(e.endAt).getTime() >= now - 14 * 864e5);
  return Promise.all(events.slice(0, 30).map(async (e) => {
    const cnt = await eventRef(e.id).collection("stampTaps").count().get();
    return { id: e.id, title: e.title, sport: e.sport as StampSport, startAt: e.startAt, venue: e.venue, taps: cnt.data().count };
  }));
}
export type AdminQr = { eventId: string; count: 1 | 2; token: string };
export const adminQrTokens = (eventId: string): { 1: string; 2: string } | null => { const s = formSecret(); return s ? { 1: qrToken(s, eventId, 1), 2: qrToken(s, eventId, 2) } : null; };
export type AdminStampTag = { sport: StampSport; version: number; token: string };
export async function adminStampTags(): Promise<AdminStampTag[]> {
  const secret = formSecret();
  return Promise.all(STAMP_SPORTS.map(async (sport) => {
    const version = await getTagVersion(sport);
    return { sport, version, token: secret ? tagToken(secret, sport, version) : "" };
  }));
}

export type DiscountInfo = { enabled: boolean; points: number; tapped: boolean; index: number; discountYen: number; applied: number | null };
// 受付画面用: このイベントの、メンバーに紐づく参加確定の申込ごとの、スタンプ割引の状況。
export async function stampDiscounts(_eventId: string): Promise<Record<string, DiscountInfo>> {
  return {}; // 直接値引きは廃止(クーポンのみ)
}

export type ApplyResult = "retired" | "ok" | "not_found" | "closed" | "no_discount" | "already" | "group" | "paid" | "off";
// スタンプ割引を、その申込の参加費に反映する(1人分の申込だけ。金額はサーバーで計算し直す。二重適用しない)。
export async function applyStampDiscount(_eventId: string, _regId: string, _by: string): Promise<ApplyResult> {
  return "retired"; // 直接値引きは廃止(クーポンのみ)
}

// ---- 受付+支払い確認 → スタンプ確定(受付QR方式) ----
// 条件: 参加確定の申込・受付済み(checkedIn)・支払い確認済み(入金額が参加費に達している)・カードON。順序は問わない(受付が先でも支払いが先でも、後から揃った時点で付く)。
// 付与は、旧方式と同じ events/{id}/stampTaps/{memberId} を作るため、NFC/QRで付いた人には重ねて付かない(併存)。
// 参加費0円(無料券など)は、ポイントを付けるかが未確定のため付けない("hold")。何度呼んでも二重に付かない(冪等)。
export type SettleResult = "awarded" | "already" | "waiting" | "hold" | "off" | "skip";
export async function settleVisitStamp(eventId: string, regId: string, now = Date.now()): Promise<SettleResult> {
  if (!validId(eventId) || !validId(regId)) return "skip";
  const regRef = eventRef(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx): Promise<SettleResult> => {
    const [evSnap, regSnap, cfg] = await Promise.all([tx.get(eventRef(eventId)), tx.get(regRef), tx.get(configRef())]);
    const parsed = eventSchema.safeParse(evSnap.data());
    const r = regSnap.data();
    if (!parsed.success || !isStampSport(parsed.data.sport) || !r || r.status !== "confirmed" || typeof r.memberId !== "string" || !validId(r.memberId)) return "skip";
    const ev = parsed.data, memberId = r.memberId as string, sport = ev.sport as StampSport;
    const [card, done] = await Promise.all([tx.get(cardRef(memberId, sport)), tx.get(tapRef(eventId, memberId))]);
    if (done.exists) return "already";
    const due = (r.feeYen as number) * (r.partySize as number);
    if (!(due > 0)) return "hold";
    if (r.checkedIn !== true || (r.paidYen ?? 0) < due) return "waiting";
    if (card.data()?.enabled !== true) return "off";
    // カードをONにする前の参加には、さかのぼって付けない(再確定でも同じ)。ONにした時刻が、イベント終了(+6時間)より後なら対象外。
    const enabledAt = card.data()?.enabledAt;
    if (Number.isInteger(enabledAt) && enabledAt > new Date(ev.endAt).getTime() + TAP_AFTER_MS) return "off";
    const sourceKey = `visit_${eventId}_${memberId}`, earned = ev.stampMultiplier;
    const plan = planAward(card.data(), earned, sourceKey, rewardsFromSnap(cfg));
    const cps = await prepCoupons(tx, memberId, sport, plan.coupons);
    tx.create(tapRef(eventId, memberId), { memberId, eventId, sport, regId, at: now, via: "reception", earned, totalBefore: totalOf(plan.before), pointsAfter: plan.after.points, lapAfter: plan.after.lap });
    tx.update(cardRef(memberId, sport), { lap: plan.after.lap, points: plan.after.points, model: 2, visits: FieldValue.increment(1), lastTapAt: now, updatedAt: now });
    writeCoupons(tx, cfg, { memberId, sport, eventId, sourceKey, coupons: cps, now, reason: "参加スタンプ" });
    return "awarded";
  });
}

// 受付・支払いが済んでいるのに、スタンプの確定だけが失敗して残っている申込を確定し直す(受付画面を開いたときに呼ぶ。冪等)。
export async function settleEventStamps(eventId: string, now = Date.now()): Promise<number> {
  if (!validId(eventId)) return 0;
  const regs = (await eventRef(eventId).collection("registrations").get()).docs.filter((d) => {
    const r = d.data();
    return r.status === "confirmed" && r.checkedIn === true && typeof r.memberId === "string" && (r.feeYen as number) * (r.partySize as number) > 0 && (r.paidYen ?? 0) >= (r.feeYen as number) * (r.partySize as number);
  });
  let n = 0;
  for (const d of regs) { try { if ((await settleVisitStamp(eventId, d.id, now)) === "awarded") n++; } catch { /* 次回の表示で再試行 */ } }
  return n;
}

// ---- 自分のポイント画面用(本人の分だけ。会員IDは、必ずログインのセッションから渡す) ----
export type MyCoupon = { id: string; sport: StampSport; kind: "discount" | "free"; yen: number; lap: number; threshold: number; issuedAt: number; status: "active" | "used" | "cancelled"; usedAt: number | null; expiresAt: number | null; reason: string };
export type MyPoints = { cards: Record<StampSport, Card & { visits: number }>; rewards: LapRewards; coupons: MyCoupon[]; sameDay: boolean };
export async function getMyPoints(memberId: string): Promise<MyPoints | null> {
  if (!validId(memberId)) return null;
  const [snaps, cfg, cps] = await Promise.all([
    db().getAll(...STAMP_SPORTS.map((sp) => cardRef(memberId, sp))),
    configRef().get(),
    db().collection("coupons").where("memberId", "==", memberId).get(),
  ]);
  let rewards = DEFAULT_LAP_REWARDS; try { rewards = rewardsFromSnap(cfg); } catch { /* 壊れた設定は既定値で表示のみ(付与は失敗させる) */ }
  const cards = {} as MyPoints["cards"];
  STAMP_SPORTS.forEach((sp, i) => { const d = snaps[i].data(); cards[sp] = { ...cardOf(d), visits: Number.isInteger(d?.visits) ? d!.visits : 0 }; });
  const coupons = cps.docs.map((d): MyCoupon => {
    const x = d.data();
    return { id: d.id, sport: x.sport, kind: x.kind === "free" ? "free" : "discount", yen: x.yen ?? 0, lap: x.lap ?? 0, threshold: x.threshold ?? 0, issuedAt: x.issuedAt ?? 0, status: x.status === "used" || x.status === "cancelled" ? x.status : "active", usedAt: x.usedAt ?? null, expiresAt: x.expiresAt ?? null, reason: x.reason ?? "" };
  }).filter((c) => isStampSport(c.sport)).sort((a, b) => b.issuedAt - a.issuedAt);
  return { cards, rewards, coupons, sameDay: policyFromSnap(cfg).sameDay };
}

export async function getRewards(): Promise<LapRewards> {
  try { return rewardsFromSnap(await configRef().get()); } catch { return DEFAULT_LAP_REWARDS; }
}
