import "server-only";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import { isStampSport, type StampSport } from "@/lib/domain/stamps";
import { LAP_SIZE, cardStateOf, parseLapRewards, planAward, revokePoints, stateOf, totalOf, type LapRewards, type Reward, DEFAULT_LAP_REWARDS } from "@/lib/domain/stampcard2";
import { cardRef, configRef, couponRef, eventRef, policyFromSnap, prepCoupons, rewardsFromSnap, settleVisitStamp, validId, writeCoupons, type CouponPolicy } from "@/lib/repo/stamps";

// 主催者専用(呼び出し側で requireAdmin() を済ませること)。ポイント・クーポンの手動操作。すべて監査用の記録(stampLedger / クーポンの履歴)を残す。
// stampLedger/{操作ID} … { memberId, sport, kind: "bonus"|"revoke"|"coupon_issue"|"coupon_cancel"|"coupon_use", delta, reason, note, by, at, ... }
//   操作ID(フォームごとに発行)を tx.create するため、再送・二重クリックでも1回だけ。通常の参加ポイント(stampTaps)とは別に記録する(ボーナスは kind=bonus)。
export const REASONS = ["受付忘れ", "友達紹介", "初参加特典", "キャンペーン", "付与ミスの修正", "その他"] as const;
// 「当日」は、発行した日と同じ日本時間の日付(開催イベントが同じかどうかではなく、日付で判定)。
const jstDay = (ms: number) => Math.floor((ms + 9 * 3600e3) / 864e5);
const ledgerRef = (id: string) => db().collection("stampLedger").doc(id);
const reasonOk = (r: unknown): r is string => typeof r === "string" && (REASONS as readonly string[]).includes(r);
const noteOk = (n: unknown) => typeof n === "string" && n.length <= 200;

export type MemberHit = { id: string; nickname: string };
export async function searchMembers(q: string): Promise<MemberHit[]> {
  const t = q.normalize("NFKC").trim().toLowerCase();
  if (t.length < 1 || t.length > 30) return [];
  const snap = await db().collection("members").select("nickname", "nicknameKey").limit(2000).get();
  return snap.docs.map((d) => ({ id: d.id, nickname: String(d.data().nickname), key: String(d.data().nicknameKey ?? "") }))
    .filter((m) => m.nickname.normalize("NFKC").toLowerCase().includes(t) || m.id === q.trim()).slice(0, 30).map(({ id, nickname }) => ({ id, nickname }));
}

export type CouponRow = { id: string; sport: string; kind: "discount" | "free"; yen: number; lap: number; threshold: number; issuedAt: number; reason: string; status: "active" | "used" | "cancelled"; usedAt: number | null; usedEventId: number | string | null; expiresAt: number | null; eventId: string | null };
const couponRow = (id: string, d: FirebaseFirestore.DocumentData): CouponRow => ({
  id, sport: d.sport, kind: d.kind === "free" ? "free" : "discount", yen: d.yen ?? 0, lap: d.lap ?? 0, threshold: d.threshold ?? 0, issuedAt: d.issuedAt ?? 0, reason: d.reason ?? "",
  status: d.status === "used" || d.status === "cancelled" ? d.status : "active", usedAt: d.usedAt ?? null, usedEventId: d.usedEventId ?? null, expiresAt: d.expiresAt ?? null, eventId: d.eventId ?? null,
});
export type LedgerRow = { id: string; kind: string; sport: string; delta: number; reason: string; note: string; by: string; at: number };
export type MemberStamp = { id: string; nickname: string; cards: Record<StampSport, { enabled: boolean; lap: number; points: number; visits: number; toNext: number }>; coupons: CouponRow[]; ledger: LedgerRow[] };

export async function memberStamp(memberId: string): Promise<MemberStamp | null> {
  if (!validId(memberId)) return null;
  const m = await db().collection("members").doc(memberId).get();
  if (!m.exists) return null;
  const sports = ["badminton", "volleyball"] as const;
  const [cards, cps, led] = await Promise.all([
    db().getAll(...sports.map((s) => cardRef(memberId, s))),
    db().collection("coupons").where("memberId", "==", memberId).get(),
    db().collection("stampLedger").where("memberId", "==", memberId).get(),
  ]);
  const out = {} as MemberStamp["cards"];
  sports.forEach((s, i) => { const d = cards[i].data(), st = cardStateOf(d); out[s] = { enabled: d?.enabled === true, lap: st.lap, points: st.points, visits: Number.isInteger(d?.visits) ? d!.visits : 0, toNext: st.points < 3 ? 3 - st.points : LAP_SIZE - st.points }; });
  return {
    id: memberId, nickname: String(m.data()!.nickname), cards: out,
    coupons: cps.docs.map((d) => couponRow(d.id, d.data())).sort((a, b) => b.issuedAt - a.issuedAt),
    ledger: led.docs.map((d) => ({ id: d.id, kind: d.data().kind, sport: d.data().sport ?? "", delta: d.data().delta ?? 0, reason: d.data().reason ?? "", note: d.data().note ?? "", by: d.data().by ?? "", at: d.data().at ?? 0 })).sort((a, b) => b.at - a.at).slice(0, 100),
  };
}

export type GrantResult = { result: "ok" | "invalid" | "not_found" | "needs_confirm" | "duplicate"; affected?: CouponRow[]; couponsIssued?: number; expectKey?: string };
// ポイントの付与(count>0)と取り消し(count<0)。理由必須。付与は、5ポイントを超えた分を繰り越し、跨いだ特典のクーポンを漏れなく発行する。
// 取り消しで、すでに発行したクーポンの条件を割り込む場合は、確認(confirm=true)がなければ実行せず、影響するクーポンを返す。確認のうえで実行すると、未使用のクーポンは取り消し、使用済みは触らない(警告のみ)。
export async function adminAdjustPoints(a: { memberId: string; sport: string; count: number; reason: string; note: string; opId: string; confirm: boolean; expect?: string; by: string }, now = Date.now()): Promise<GrantResult> {
  if (!validId(a.memberId) || !validId(a.opId) || !isStampSport(a.sport) || !Number.isInteger(a.count) || a.count === 0 || Math.abs(a.count) > 100 || !reasonOk(a.reason) || !noteOk(a.note)) return { result: "invalid" };
  const sport = a.sport as StampSport;
  return db().runTransaction(async (tx): Promise<GrantResult> => {
    const [led, mem, card, cfg, cps] = await Promise.all([
      tx.get(ledgerRef(a.opId)), tx.get(db().collection("members").doc(a.memberId)), tx.get(cardRef(a.memberId, sport)), tx.get(configRef()),
      tx.get(db().collection("coupons").where("memberId", "==", a.memberId).where("sport", "==", sport)),
    ]);
    if (led.exists) return { result: "duplicate" };
    if (!mem.exists) return { result: "not_found" };
    const now2 = now, base = { memberId: a.memberId, sport, reason: a.reason, note: a.note, by: a.by, at: now2 };
    if (a.count > 0) {
      const plan = planAward(card.data(), a.count, `adm_${a.opId}`, rewardsFromSnap(cfg));
      const cps = await prepCoupons(tx, a.memberId, sport, plan.coupons);
      writeCoupons(tx, cfg, { memberId: a.memberId, sport, eventId: null, sourceKey: `adm_${a.opId}`, coupons: cps, now: now2, reason: `管理者付与(${a.reason})` });
      const fields = { lap: plan.after.lap, points: plan.after.points, model: 2, updatedAt: now2 };
      if (card.exists) tx.update(card.ref, fields); else tx.create(card.ref, { memberId: a.memberId, sport, enabled: false, createdAt: now2, ...fields });
      tx.create(ledgerRef(a.opId), { ...base, kind: "bonus", delta: a.count, totalBefore: totalOf(plan.before), couponIds: cps.map((c) => c.id) });
      return { result: "ok", couponsIssued: cps.length };
    }
    if (!card.exists) return { result: "invalid" }; // カードがなければ取り消すポイントがない
    const st = cardStateOf(card.data());
    const issued = cps.docs.filter((d) => d.data().status !== "cancelled").map((d) => ({ doc: d, lap: d.data().lap as number, threshold: d.data().threshold as 3 | 5, reward: { kind: "free" } as Reward, used: d.data().status === "used" }));
    const r = revokePoints(st, -a.count, issued);
    const affected = r.affected as unknown as typeof issued;
    // 確認は、画面で警告した対象(クーポンID)と一致するときだけ有効。警告のあとで対象が変わっていたら、実行せずに新しい警告を返す。
    const key = affected.map((x) => x.doc.id).sort().join(",");
    if (affected.length && (!a.confirm || (a.expect ?? "") !== key)) return { result: "needs_confirm", affected: affected.map((x) => couponRow(x.doc.id, x.doc.data())), expectKey: key };
    for (const x of affected) if (!x.used) tx.update(x.doc.ref, { status: "cancelled", cancelledAt: now2, cancelledBy: a.by, cancelReason: `ポイント取り消し(${a.reason})` });
    tx.set(card.ref, { lap: r.state.lap, points: r.state.points, model: 2, updatedAt: now2 }, { merge: true });
    tx.create(ledgerRef(a.opId), { ...base, kind: "revoke", delta: a.count, totalBefore: totalOf(st), cancelledCoupons: affected.filter((x) => !x.used).map((x) => x.doc.id), usedCouponsKept: affected.filter((x) => x.used).map((x) => x.doc.id) });
    return { result: "ok" };
  });
}

// クーポンの手動発行(会員を指定)。
export async function adminIssueCoupon(a: { memberId: string; sport: string; kind: "discount" | "free"; yen: number; reason: string; note: string; opId: string; by: string }, now = Date.now()): Promise<"ok" | "invalid" | "not_found" | "duplicate"> {
  if (!validId(a.memberId) || !validId(a.opId) || !isStampSport(a.sport) || !reasonOk(a.reason) || !noteOk(a.note)) return "invalid";
  if (a.kind !== "free" && a.kind !== "discount") return "invalid";
  if (a.kind === "discount" && (!Number.isInteger(a.yen) || a.yen < 1 || a.yen > 100_000)) return "invalid";
  return db().runTransaction(async (tx) => {
    const [led, mem, cfg] = await Promise.all([tx.get(ledgerRef(a.opId)), tx.get(db().collection("members").doc(a.memberId)), tx.get(configRef())]);
    if (led.exists) return "duplicate";
    if (!mem.exists) return "not_found";
    const id = `man_${a.opId}`;
    writeCoupons(tx, cfg, { memberId: a.memberId, sport: a.sport as StampSport, eventId: null, sourceKey: id, coupons: [{ id, mode: "create", lap: 0, threshold: 3, reward: a.kind === "free" ? { kind: "free" } : { kind: "discount", yen: a.yen } }], now, reason: `管理者発行(${a.reason})` });
    tx.create(ledgerRef(a.opId), { memberId: a.memberId, sport: a.sport, kind: "coupon_issue", delta: 0, reason: a.reason, note: a.note, by: a.by, at: now, couponId: id });
    return "ok";
  });
}

export async function adminCancelCoupon(couponId: string, reason: string, by: string, now = Date.now()): Promise<"ok" | "invalid" | "not_found" | "used"> {
  if (!validId(couponId) || !reasonOk(reason)) return "invalid";
  return db().runTransaction(async (tx) => {
    const s = await tx.get(couponRef(couponId));
    if (!s.exists) return "not_found";
    if (s.data()!.status === "used") return "used";
    if (s.data()!.status === "cancelled") return "ok";
    tx.update(s.ref, { status: "cancelled", cancelledAt: now, cancelledBy: by, cancelReason: reason });
    tx.set(ledgerRef(`cc_${couponId}`), { memberId: s.data()!.memberId, sport: s.data()!.sport, kind: "coupon_cancel", delta: 0, reason, note: "", by, at: now, couponId });
    return "ok";
  });
}

// ---- クーポンの使用(受付での値引き)。二重使用不可: 状態が active のときだけ used にする(同じトランザクション)。 ----
// 1申込につき1枚(併用は未確定のため不可)。1人分の申込だけ。会計確定・入金超過は拒否。発行されたイベントの当日は、設定(sameDay)がなければ使えない。
export type UseResult = "ok" | "not_found" | "not_active" | "expired" | "same_day" | "group" | "already_has" | "closed" | "paid" | "sport" | "invalid";
export async function redeemCoupon(eventId: string, regId: string, couponId: string, by: string, now = Date.now()): Promise<UseResult> {
  const r = await redeemCouponTx(eventId, regId, couponId, by, now);
  if (r === "ok") { try { await settleVisitStamp(eventId, regId, now); } catch { /* 次の操作・受付画面の再確認で確定される(冪等) */ } } // 請求額が下がって、入金が足りた状態になった場合に、スタンプを確定する
  return r;
}
async function redeemCouponTx(eventId: string, regId: string, couponId: string, by: string, now: number): Promise<UseResult> {
  if (!validId(eventId) || !validId(regId) || !validId(couponId)) return "invalid";
  const regRef = eventRef(eventId).collection("registrations").doc(regId);
  return db().runTransaction(async (tx): Promise<UseResult> => {
    const [ev, reg, cp, acct, cfg] = await Promise.all([tx.get(eventRef(eventId)), tx.get(regRef), tx.get(couponRef(couponId)), tx.get(db().collection("accounting").doc(eventId)), tx.get(configRef())]);
    const p = eventSchema.safeParse(ev.data()), r = reg.data(), c = cp.data();
    if (!p.success || !r || r.status !== "confirmed" || !c || c.memberId !== r.memberId) return "not_found";
    if (c.status !== "active") return "not_active";
    if (c.sport !== p.data.sport) return "sport";
    if (c.expiresAt && c.expiresAt < now) return "expired";
    const pol: CouponPolicy = policyFromSnap(cfg);
    if (!pol.sameDay && jstDay(c.issuedAt ?? 0) === jstDay(now)) return "same_day";
    if (acct.exists && acct.data()?.closed === true) return "closed";
    if (r.partySize !== 1) return "group";
    if (r.couponId) return "already_has";
    const base = r.feeYen as number, fee = c.kind === "free" ? 0 : Math.max(0, base - (c.yen as number));
    if (fee * r.partySize < (r.paidYen ?? 0)) return "paid";
    tx.update(cp.ref, { status: "used", usedAt: now, usedEventId: eventId, usedRegId: regId, usedBy: by });
    tx.update(regRef, { feeYen: fee, baseFeeYen: base, couponId, couponYen: base - fee, updatedAt: now });
    tx.set(eventRef(eventId).collection("audit").doc(), { at: now, by, action: "coupon_use", regId, couponId, from: base, to: fee });
    tx.set(ledgerRef(`cu_${couponId}`), { memberId: c.memberId, sport: c.sport, kind: "coupon_use", delta: 0, reason: "クーポン使用", note: "", by, at: now, couponId, eventId });
    return "ok";
  });
}
// 受付画面用: その申込の会員が持つ、使えるクーポン。
export async function usableCoupons(eventId: string, memberId: string, now = Date.now()): Promise<CouponRow[]> {
  if (!validId(eventId) || !validId(memberId)) return [];
  const [snap, cfg] = await Promise.all([db().collection("coupons").where("memberId", "==", memberId).get(), configRef().get()]);
  const pol = policyFromSnap(cfg);
  return snap.docs.map((d) => couponRow(d.id, d.data())).filter((c) => c.status === "active" && (!c.expiresAt || c.expiresAt >= now) && (pol.sameDay || jstDay(c.issuedAt) !== jstDay(now)));
}

// ---- 特典内容・クーポンの運用設定 ----
export async function getStampSettings(): Promise<{ rewards: LapRewards; policy: CouponPolicy }> {
  const s = await configRef().get();
  let rewards = DEFAULT_LAP_REWARDS; try { rewards = rewardsFromSnap(s); } catch { /* 壊れていれば既定値を表示。保存時に直る */ }
  return { rewards, policy: policyFromSnap(s) };
}
export async function setStampSettings(input: { rewards: unknown; sameDay: boolean; expiryDays: number | null }, by: string): Promise<"ok" | "invalid"> {
  const rewards = parseLapRewards(input.rewards);
  if (!rewards || (input.expiryDays !== null && (!Number.isInteger(input.expiryDays) || input.expiryDays < 1 || input.expiryDays > 3650))) return "invalid";
  const before = await getStampSettings();
  const batch = db().batch();
  batch.set(configRef(), { lapRewards: rewards, couponPolicy: { sameDay: input.sameDay, expiryDays: input.expiryDays }, updatedAt: Date.now(), updatedBy: by }, { merge: true });
  batch.set(configRef().collection("history").doc(), { at: Date.now(), by, kind: "lap_settings", before, after: { rewards, sameDay: input.sameDay, expiryDays: input.expiryDays } });
  await batch.commit();
  return "ok";
}
export { stateOf };

// 受付画面用: 申込ごとの、スタンプの状況(付与済み/付与待ち/対象外)と、使えるクーポン。表示専用(付与・使用はサーバーで再判定する)。
export type RegStamp = { state: "awarded" | "waiting" | "none"; checkedInAt: number | null; couponYen: number | null; coupons: CouponRow[] };
export async function eventStampStatus(eventId: string, now = Date.now()): Promise<Record<string, RegStamp>> {
  if (!validId(eventId)) return {};
  const regs = (await eventRef(eventId).collection("registrations").get()).docs.filter((d) => d.data().status === "confirmed");
  const withMember = regs.filter((d) => typeof d.data().memberId === "string" && validId(d.data().memberId));
  const taps = withMember.length ? await db().getAll(...withMember.map((d) => eventRef(eventId).collection("stampTaps").doc(d.data().memberId))) : [];
  const out: Record<string, RegStamp> = {};
  await Promise.all(regs.map(async (d) => {
    const i = withMember.indexOf(d), mid = d.data().memberId as string | undefined;
    const coupons = i >= 0 && !d.data().couponId && d.data().partySize === 1 ? await usableCoupons(eventId, mid!, now) : [];
    out[d.id] = {
      state: i < 0 ? "none" : taps[i].exists ? "awarded" : "waiting",
      checkedInAt: Number.isInteger(d.data().checkedInAt) ? d.data().checkedInAt : null,
      couponYen: Number.isInteger(d.data().couponYen) ? d.data().couponYen : null, coupons,
    };
  }));
  return out;
}
