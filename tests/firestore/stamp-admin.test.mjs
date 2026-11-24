// 管理者のポイント・クーポン操作: 付与/取消・繰り越し・クーポン発行/取消/使用・二重使用防止・取消の整合性警告・理由必須・再送の冪等性。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("管理者のスタンプ操作", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const A = await import("@/lib/repo/stampadmin");
  const S = await import("@/lib/repo/stamps");
  const rnd = () => randomBytes(4).toString("hex");
  const memberIds = [], eventIds = [], ledgerIds = [];
  const cfgBefore = await db().collection("stampConfig").doc("default").get();
  const startedAt = Date.now();
  after(async () => {
    for (const id of memberIds) {
      const m = await db().collection("members").doc(id).get();
      if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); }
      for (const sp of ["badminton", "volleyball"]) await db().collection("stampCards").doc(`${id}_${sp}`).delete().catch(() => {});
      for (const c of (await db().collection("coupons").where("memberId", "==", id).get()).docs) await c.ref.delete();
      for (const c of (await db().collection("stampLedger").where("memberId", "==", id).get()).docs) await c.ref.delete();
    }
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
    const cfg = db().collection("stampConfig").doc("default");
    if (cfgBefore.exists) await cfg.set(cfgBefore.data()); else await cfg.delete().catch(() => {});
    for (const d of (await cfg.collection("history").where("at", ">=", startedAt).get()).docs) await d.ref.delete();
  });
  const mkMember = async (t) => { const n = `zz_test_${t}${rnd()}`.slice(0, 20); const r = await Mem.createMember(n, "テスト用パスワード-12345", "self"); assert.ok(r.ok); memberIds.push(r.id); return { id: r.id, nickname: n }; };
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
  const NOW = Date.now(), H = 3600e3;
  const mkEvent = async (fee = 500) => { const id = `zz_test_${rnd()}`; await db().collection("events").doc(id).set({ title: "【自動テスト】管理", sport: "badminton", venue: "テスト会場", startAt: iso(NOW + 5 * H), endAt: iso(NOW + 7 * H), feeYen: fee, capacity: 20, belongings: "", notes: "", status: "published" }); eventIds.push(id); return id; };
  const adj = (m, count, extra = {}) => A.adminAdjustPoints({ memberId: m.id, sport: "badminton", count, reason: "付与ミスの修正", note: "", opId: `op${rnd()}${rnd()}`, confirm: false, by: "test", ...extra });
  // 警告の対象(クーポンID)を確認したうえで取り消す(画面と同じ手順: 警告→確認つきで再実行)
  const adjC = async (m, count) => { const r = await adj(m, count); if (r.result !== "needs_confirm") return r; return adj(m, count, { confirm: true, expect: r.expectKey }); };
  const card = async (m) => (await S.getCards(m.id)).badminton;
  const coupons = async (m) => (await db().collection("coupons").where("memberId", "==", m.id).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const T = { timeout: 120_000 };

  test("ポイント付与: 任意の個数・繰り越し・特典(クーポン)を漏れなく発行。理由必須。同じ操作IDの再送は1回だけ", T, async () => {
    const m = await mkMember("G");
    assert.equal((await adj(m, 3)).result, "ok"); let c = await card(m); assert.deepEqual([c.lap, c.points], [1, 3]);
    assert.equal((await coupons(m)).length, 1);
    const r = await adj(m, 4); assert.equal(r.result, "ok"); assert.equal(r.couponsIssued, 1);
    c = await card(m); assert.deepEqual([c.lap, c.points], [2, 2]); // 3+4=7 → 2周目2pt(5pt到達で1枚)
    const cs = await coupons(m); assert.equal(cs.length, 2);
    const big = await adj(m, 6); assert.equal(big.couponsIssued, 3); // 累計13: 2周目の3pt・5pt(偶数周: 200円引き・無料)と、3周目の3pt
    assert.deepEqual([(await card(m)).lap, (await card(m)).points], [3, 3]);
    const kinds = (await coupons(m)).filter((x) => x.lap === 2).map((x) => [x.threshold, x.kind, x.yen]).sort(); assert.deepEqual(kinds, [[3, "discount", 200], [5, "free", 0]]);
    const op = `op${rnd()}${rnd()}`, p = await card(m);
    assert.equal((await adj(m, 1, { opId: op })).result, "ok"); assert.equal((await adj(m, 1, { opId: op })).result, "duplicate");
    assert.equal((await card(m)).points, p.points + 1);
    assert.equal((await adj(m, 1, { reason: "なんとなく" })).result, "invalid");
    assert.equal((await adj(m, 0)).result, "invalid");
    const info = await A.memberStamp(m.id); assert.ok(info.ledger.some((l) => l.kind === "bonus"), "ボーナスは通常参加と区別して記録");
    assert.equal(info.cards.badminton.visits, 0, "参加回数とポイントは別");
  });

  test("ポイント取り消し: 矛盾するクーポンがあれば警告して実行しない→確認後は未使用だけ取り消し、使用済みは残す", T, async () => {
    const m = await mkMember("V"); await adj(m, 5); // 1周目の3pt・5ptクーポン、2周目0
    const cs = await coupons(m); assert.equal(cs.length, 2);
    const c3 = cs.find((x) => x.threshold === 3);
    await db().collection("coupons").doc(c3.id).update({ status: "used" }); // 3ptは使用済み
    let r = await adj(m, -3);
    assert.equal(r.result, "needs_confirm"); assert.deepEqual(r.affected.map((x) => x.threshold).sort(), [3, 5]);
    assert.deepEqual([(await card(m)).lap, (await card(m)).points], [2, 0], "確認前は変わらない");
    assert.equal((await adj(m, -3, { confirm: true })).result, "needs_confirm", "警告した対象と結びつかない確認は無効");
    r = await adjC(m, -3); assert.equal(r.result, "ok");
    assert.deepEqual([(await card(m)).lap, (await card(m)).points], [1, 2]);
    const after1 = await coupons(m);
    assert.equal(after1.find((x) => x.threshold === 5).status, "cancelled");
    assert.equal(after1.find((x) => x.threshold === 3).status, "used", "使用済みは自動で触らない");
    const nomatter = await adj(m, -1); assert.equal(nomatter.result, "ok"); // 1pt: 条件に影響なし
    const z = await mkMember("N"); assert.equal((await adj(z, -1)).result, "invalid", "カードなし");
  });

  test("クーポン: 手動発行/取消・使用(二重使用不可・1申込1枚・当日不可・他人/別競技不可)", T, async () => {
    const m = await mkMember("C"), o = await mkMember("O");
    const op = `op${rnd()}${rnd()}`;
    const base = { memberId: m.id, sport: "badminton", kind: "discount", yen: 150, reason: "キャンペーン", note: "", by: "test" };
    assert.equal(await A.adminIssueCoupon({ ...base, opId: op }), "ok"); assert.equal(await A.adminIssueCoupon({ ...base, opId: op }), "duplicate");
    assert.equal(await A.adminIssueCoupon({ ...base, opId: `op${rnd()}`, yen: 0 }), "invalid");
    assert.equal(await A.adminIssueCoupon({ ...base, opId: `op${rnd()}${rnd()}`, kind: "free", yen: 0 }), "ok");
    for (const c of await coupons(m)) await db().collection("coupons").doc(c.id).update({ issuedAt: NOW - 2 * 864e5 }); // 「当日不可」(日本時間の同じ日)に当たらないよう、発行日を過去にする
    const cs = await coupons(m); assert.equal(cs.length, 2);
    const disc = cs.find((x) => x.kind === "discount"), free = cs.find((x) => x.kind === "free");
    const e = await mkEvent(500);
    const reg = await R.createRegistration(e, { nickname: m.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id }); assert.ok(reg.ok);
    const regId = (await db().collection("events").doc(e).collection("registrations").where("memberId", "==", m.id).get()).docs[0].id;
    const ro = await R.createRegistration(e, { nickname: o.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: o.id }); assert.ok(ro.ok);
    const roId = (await db().collection("events").doc(e).collection("registrations").where("memberId", "==", o.id).get()).docs[0].id;
    assert.equal(await A.redeemCoupon(e, roId, disc.id, "t"), "not_found", "他人のクーポンは使えない");
    const res = await Promise.all([1, 2, 3].map(() => A.redeemCoupon(e, regId, disc.id, "t")));
    assert.equal(res.filter((x) => x === "ok").length, 1, JSON.stringify(res));
    const rg = (await db().collection("events").doc(e).collection("registrations").doc(regId).get()).data();
    assert.deepEqual([rg.feeYen, rg.baseFeeYen, rg.couponYen], [350, 500, 150]);
    assert.equal(await A.redeemCoupon(e, regId, disc.id, "t"), "not_active", "二重使用なし");
    assert.equal(await A.redeemCoupon(e, regId, free.id, "t"), "already_has", "1申込1枚");
    assert.equal(await A.adminCancelCoupon(disc.id, "付与ミスの修正", "t"), "used");
    assert.equal(await A.adminCancelCoupon(free.id, "その他", "t"), "ok");
    assert.equal(await A.redeemCoupon(e, regId, free.id, "t"), "not_active", "取り消したクーポンは使えない");
    // 当日不可(初期設定): そのイベントで発行されたクーポンは、そのイベントでは使えない
    const m2 = await mkMember("S"); await db().collection("coupons").doc(`zz_c_${rnd()}`).set({ memberId: m2.id, sport: "badminton", kind: "discount", yen: 100, status: "active", eventId: "other", lap: 1, threshold: 3, issuedAt: NOW, expiresAt: null });
    const reg2 = await R.createRegistration(e, { nickname: m2.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m2.id }); assert.ok(reg2.ok);
    const r2 = (await db().collection("events").doc(e).collection("registrations").where("memberId", "==", m2.id).get()).docs[0].id;
    const c2 = (await coupons(m2))[0];
    assert.equal(await A.redeemCoupon(e, r2, c2.id, "t"), "same_day");
    assert.equal((await A.usableCoupons(e, m2.id)).length, 0);
    // 有効期限切れ
    await db().collection("coupons").doc(c2.id).update({ issuedAt: NOW - 3 * 864e5, expiresAt: NOW - 1000 });
    assert.equal(await A.redeemCoupon(e, r2, c2.id, "t"), "expired");
  });

  test("特典内容の設定: 不正は拒否・正しい値は保存され履歴が残る・当日使用の切り替えが効く", T, async () => {
    const cur = await A.getStampSettings();
    assert.equal(await A.setStampSettings({ rewards: { odd: {} }, sameDay: false, expiryDays: null }, "t"), "invalid");
    assert.equal(await A.setStampSettings({ rewards: cur.rewards, sameDay: false, expiryDays: 0 }, "t"), "invalid");
    assert.equal(await A.setStampSettings({ rewards: cur.rewards, sameDay: true, expiryDays: 90 }, "t"), "ok");
    const now = await A.getStampSettings(); assert.deepEqual([now.policy.sameDay, now.policy.expiryDays], [true, 90]);
    const m = await mkMember("P"); await adj(m, 3); const c = (await coupons(m))[0];
    assert.ok(c.expiresAt > NOW + 89 * 864e5, "有効日数が反映される");
  });

  test("再到達: 使用済みの特典は再発行しない。ポイント取り消しで取り消した未使用券は、再到達で戻る(管理者が個別に取り消した券は戻らない)", T, async () => {
    const m = await mkMember("R"); await adj(m, 3);
    const c1 = (await coupons(m))[0]; await db().collection("coupons").doc(c1.id).update({ status: "used" });
    assert.equal((await adj(m, -1)).result, "needs_confirm"); assert.equal((await adjC(m, -1)).result, "ok");
    assert.equal((await adj(m, 1)).result, "ok");
    const after = await coupons(m); assert.equal(after.length, 1, "使用済みの特典は、再到達しても再発行しない"); assert.equal(after[0].status, "used");
    const n = await mkMember("U"); await adj(n, 3);
    assert.equal((await adjC(n, -1)).result, "ok");
    assert.equal((await coupons(n))[0].status, "cancelled");
    await adj(n, 1); const re = await coupons(n); assert.equal(re.length, 1); assert.equal(re[0].status, "active", "取り消された未使用券は、再到達で戻る");
    const k = await mkMember("K"); await adj(k, 3); const kc = (await coupons(k))[0];
    assert.equal(await A.adminCancelCoupon(kc.id, "その他", "t"), "ok");
    await adjC(k, -1); await adj(k, 1);
    assert.equal((await coupons(k))[0].status, "cancelled", "管理者が個別に取り消した券は、再到達でも戻らない");
    assert.ok(kc.id.length <= 64 && kc.id.startsWith("c_"), "ID長は固定");
  });
}
