// 受付QR+支払い確認でのスタンプ確定・当日参加・承認待ち・併存(NFCとの二重付与なし)・倍率・クーポン・JST期限。
// 実Firestoreで確認する(npm run test:firestore)。テスト用のデータは zz_test_ で始め、終わりに削除する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("受付QR", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const S = await import("@/lib/repo/stamps");
  const Q = await import("@/lib/repo/receptionqr");
  const Rc = await import("@/lib/repo/reception");
  const { issueTokens } = await import("@/lib/domain/receptionqr");
  const { formSecret } = await import("@/lib/repo/formtoken");

  const rnd = () => randomBytes(4).toString("hex");
  const PW = "テスト用パスワード-12345";
  const memberIds = [], eventIds = [];
  after(async () => {
    for (const id of memberIds) {
      const m = await db().collection("members").doc(id).get();
      if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); }
      for (const sp of ["badminton", "volleyball"]) await db().collection("stampCards").doc(`${id}_${sp}`).delete().catch(() => {});
      const cs = await db().collection("coupons").where("memberId", "==", id).get(); for (const c of cs.docs) await c.ref.delete();
      for (const c of (await db().collection("stampLedger").where("memberId", "==", id).get()).docs) await c.ref.delete();
    }
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
  });
  const mkMember = async (t) => { const n = `zz_test_${t}${rnd()}`.slice(0, 20); const r = await Mem.createMember(n, PW, "self"); assert.ok(r.ok, JSON.stringify(r)); memberIds.push(r.id); return { id: r.id, nickname: n }; };
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
  const mkEvent = async ({ startMs, endMs, fee = 500, capacity = 20, mult = 1 }) => {
    const id = `zz_test_${rnd()}`;
    await db().collection("events").doc(id).set({ title: "【自動テスト】受付QR", sport: "badminton", venue: "テスト会場", startAt: iso(startMs), endAt: iso(endMs), feeYen: fee, capacity, belongings: "", notes: "", status: "published", stampMultiplier: mult });
    eventIds.push(id); return id;
  };
  const tokenAt = (e, ms) => issueTokens(formSecret(), e, ms, ms + 1)[0].token;
  const NOW = Date.now(), H = 3600e3;
  const live = (o = {}) => mkEvent({ startMs: NOW - H, endMs: NOW + H, ...o });
  const apply = async (e, m) => { const r = await R.createRegistration(e, { nickname: m.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id }); assert.ok(r.ok, JSON.stringify(r)); };
  // 申込は開始前でないとできない → 未来のイベントで申込んでから、開催中の時刻に直す。
  const applied = async (m, o = {}) => { const e = await mkEvent({ startMs: NOW + 5 * H, endMs: NOW + 7 * H, ...o }); await apply(e, m); await db().collection("events").doc(e).update({ startAt: iso(NOW - H), endAt: iso(NOW + H) }); return e; };
  const reg = async (e, m) => { const s = await db().collection("events").doc(e).collection("registrations").where("memberId", "==", m.id).get(); return s.docs.map((d) => ({ id: d.id, ...d.data() })); };
  const tapDoc = async (e, m) => (await db().collection("events").doc(e).collection("stampTaps").doc(m.id).get());
  const T = { timeout: 120_000 };

  test("事前予約者: 受付→(未払い)スタンプなし→支払い確認で付く。再読み取り・支払いの再送・NFCでも二重にならない", T, async () => {
    const a = await mkMember("A"); assert.equal(await S.setEnabled(a.id, "badminton", true), true);
    const e = await applied(a);
    const tok = tokenAt(e, NOW);
    assert.equal((await Q.scanReception(a.id, e, tok)).result, "checked_in");
    assert.equal((await Q.scanReception(a.id, e, tok)).result, "already");
    assert.equal((await reg(e, a)).length, 1, "名前(会員)の重複登録なし");
    assert.equal((await tapDoc(e, a)).exists, false, "支払い前は付かない");
    const r = (await reg(e, a))[0];
    assert.equal(await Rc.recordPayment(e, `pay${rnd()}`, [{ regId: r.id, amountYen: 500 }], "test"), "ok");
    const t = await tapDoc(e, a); assert.equal(t.exists, true); assert.equal(t.data().via, "reception");
    const c = (await S.getCards(a.id)).badminton; assert.deepEqual([c.lap, c.points], [1, 1]);
    assert.equal(await S.settleVisitStamp(e, r.id), "already");
    const { currentTagToken } = S; assert.equal((await S.tap(a.id, e, await currentTagToken("badminton"))).result, "already", "NFCと併存しても二重付与なし");
    assert.equal((await S.getCards(a.id)).badminton.points, 1);
  });

  test("順序が逆(支払いが先→受付)でも付く。カードOFFなら付かない", T, async () => {
    const b = await mkMember("B"); await S.setEnabled(b.id, "badminton", true);
    const e = await applied(b); const r = (await reg(e, b))[0];
    assert.equal(await Rc.recordPayment(e, `pay${rnd()}`, [{ regId: r.id, amountYen: 500 }], "test"), "ok");
    assert.equal((await tapDoc(e, b)).exists, false);
    assert.equal((await Q.scanReception(b.id, e, tokenAt(e, NOW))).result, "checked_in");
    assert.equal((await tapDoc(e, b)).exists, true);
    const off = await mkMember("OFF"); const e2 = await applied(off); const r2 = (await reg(e2, off))[0];
    await Rc.setCheckedIn(e2, r2.id, true, "t"); await Rc.recordPayment(e2, `pay${rnd()}`, [{ regId: r2.id, amountYen: 500 }], "t");
    assert.equal((await tapDoc(e2, off)).exists, false, "OFFのカードには付けない");
  });

  test("予約なしの会員: 当日参加として登録(同時に何回読んでも1件)。QRが古い・改ざん・別イベントは拒否", T, async () => {
    const c = await mkMember("C"); const e = await live(); const tok = tokenAt(e, NOW);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => Q.scanReception(c.id, e, tok)));
    assert.ok(rs.some((x) => x.result === "walkin_ok"), JSON.stringify(rs));
    const regs = await reg(e, c); assert.equal(regs.length, 1);
    assert.deepEqual([regs[0].source, regs[0].checkedIn, regs[0].memberId, regs[0].nickname], ["qr_walkin", true, c.id, c.nickname]);
    assert.equal((await Q.scanReception(c.id, e, tokenAt(e, NOW - 5 * 60e3))).result, "expired");
    assert.equal((await Q.scanReception(c.id, e, tok.slice(0, -2) + "xx")).result, "bad");
    const other = await live(); assert.equal((await Q.scanReception(c.id, other, tok)).result, "bad");
    assert.equal((await Q.scanReception("nonexistent_member", e, tok)).result, "invalid");
  });

  test("定員超過は承認待ち→管理者が承認すると受付済み(定員を超えて追加可)", T, async () => {
    const x = await mkMember("X"), y = await mkMember("Y");
    const e = await live({ capacity: 1 });
    const tok = tokenAt(e, NOW);
    assert.equal((await Q.scanReception(x.id, e, tok)).result, "walkin_ok");
    assert.equal((await Q.scanReception(y.id, e, tok)).result, "pending");
    assert.equal((await Q.scanReception(y.id, e, tok)).result, "pending");
    assert.equal((await reg(e, y)).length, 0);
    const list = await Q.listWalkinRequests(e); assert.deepEqual(list.map((r) => [r.memberId, r.reason]), [[y.id, "full"]]);
    assert.equal(await Q.decideWalkin(e, y.id, true, "admin"), "ok");
    assert.equal(await Q.decideWalkin(e, y.id, true, "admin"), "not_found", "二重承認なし");
    const r = await reg(e, y); assert.equal(r.length, 1); assert.equal(r[0].checkedIn, true);
    assert.equal((await Q.scanReception(y.id, e, tok)).result, "already");
  });

  test("JST期限: 開催終了後・当日中は承認待ち、翌日0:00(JST)以降は拒否。QR期限とは別", T, async () => {
    const m = await mkMember("J"), n = await mkMember("K");
    const start = Date.parse("2020-01-10T20:00:00+09:00"), end = Date.parse("2020-01-10T23:00:00+09:00");
    const e = await mkEvent({ startMs: start, endMs: end });
    const t1 = Date.parse("2020-01-10T23:30:00+09:00");
    assert.equal((await Q.scanReception(m.id, e, tokenAt(e, t1), t1)).result, "pending");
    const t2 = Date.parse("2020-01-11T00:30:00+09:00");
    assert.equal((await Q.scanReception(n.id, e, tokenAt(e, t2), t2)).result, "closed");
    assert.equal((await reg(e, n)).length, 0);
    assert.equal((await Q.listWalkinRequests(e)).length, 1);
  });

  test("倍率2倍+繰り越し: 旧カード4pt→2pt付与で5pt特典(200円引き)を発行し、2周目1pt。クーポンは再送でも1枚", T, async () => {
    const d = await mkMember("D"); await S.setEnabled(d.id, "badminton", true);
    await db().collection("stampCards").doc(`${d.id}_badminton`).update({ points: 4 });
    const e = await applied(d, { mult: 2 }); const r = (await reg(e, d))[0];
    await Rc.setCheckedIn(e, r.id, true, "t"); await Rc.recordPayment(e, `pay${rnd()}`, [{ regId: r.id, amountYen: 500 }], "t");
    await S.settleVisitStamp(e, r.id); await S.settleVisitStamp(e, r.id);
    const c = (await S.getCards(d.id)).badminton; assert.deepEqual([c.lap, c.points], [2, 1]);
    const cs = (await db().collection("coupons").where("memberId", "==", d.id).get()).docs.map((x) => x.data());
    assert.equal(cs.length, 1); assert.deepEqual([cs[0].kind, cs[0].yen, cs[0].lap, cs[0].threshold, cs[0].status], ["discount", 200, 1, 5, "active"]);
  });

  test("参加費0円はスタンプを付けない(未確定のため保留)", T, async () => {
    const z = await mkMember("Z"); await S.setEnabled(z.id, "badminton", true);
    const e = await applied(z, { fee: 0 }); const r = (await reg(e, z))[0];
    await Rc.setCheckedIn(e, r.id, true, "t");
    assert.equal(await S.settleVisitStamp(e, r.id), "hold");
  });

  test("承認待ちの間に通常申込で確定していた会員を承認しても、申込は二重にならない(その申込を受付済みにする)", T, async () => {
    const x = await mkMember("X2"), y = await mkMember("Y2");
    const e = await live({ capacity: 1 }); const tok = tokenAt(e, NOW);
    assert.equal((await Q.scanReception(x.id, e, tok)).result, "walkin_ok");
    assert.equal((await Q.scanReception(y.id, e, tok)).result, "pending");
    await db().collection("events").doc(e).collection("registrations").doc("normal_y").set({ nickname: y.nickname, members: [], partySize: 1, status: "confirmed", feeYen: 500, checkedIn: false, paidYen: 0, source: "web", memberId: y.id, createdAt: NOW, updatedAt: NOW, offerExpiresAt: null });
    assert.equal(await Q.decideWalkin(e, y.id, true, "admin"), "ok");
    const r = await reg(e, y); assert.equal(r.length, 1); assert.deepEqual([r[0].id, r[0].checkedIn], ["normal_y", true]);
  });

  test("スタンプ確定の取りこぼし対策: クーポン適用・個別料金変更で支払い条件が揃うと確定する。確定漏れは受付画面の再確認(settleEventStamps)で確定される", T, async () => {
    const A2 = await import("@/lib/repo/stampadmin");
    const a = await mkMember("CP"); await S.setEnabled(a.id, "badminton", true);
    const e = await applied(a); const r = (await reg(e, a))[0];
    await Rc.setCheckedIn(e, r.id, true, "t"); await Rc.recordPayment(e, `pay${rnd()}`, [{ regId: r.id, amountYen: 400 }], "t");
    assert.equal((await tapDoc(e, a)).exists, false, "400円では足りない");
    const op = `op${rnd()}${rnd()}`;
    assert.equal(await A2.adminIssueCoupon({ memberId: a.id, sport: "badminton", kind: "discount", yen: 100, reason: "キャンペーン", note: "", opId: op, by: "t" }), "ok");
    const cid = (await db().collection("coupons").where("memberId", "==", a.id).get()).docs[0].id;
    await db().collection("coupons").doc(cid).update({ issuedAt: NOW - 2 * 864e5 });
    assert.equal(await A2.redeemCoupon(e, r.id, cid, "t"), "ok");
    assert.equal((await tapDoc(e, a)).exists, true, "クーポンで請求額が下がり、入金が足りたので確定");
    const b = await mkMember("SW"); await S.setEnabled(b.id, "badminton", true);
    const e2 = await applied(b); const r2 = (await reg(e2, b))[0];
    await db().collection("events").doc(e2).collection("registrations").doc(r2.id).update({ checkedIn: true, paidYen: 500 }); // 確定だけが漏れた状態
    assert.equal((await tapDoc(e2, b)).exists, false);
    assert.equal(await S.settleEventStamps(e2), 1); assert.equal(await S.settleEventStamps(e2), 0);
    assert.equal((await tapDoc(e2, b)).exists, true);
  });

  test("カードをONにする前の参加には、あとから受付画面を開いても付けない。取消済みの固定ID申込があっても承認で受付済みが作られる", T, async () => {
    const a = await mkMember("BF"); const e = await applied(a); const r = (await reg(e, a))[0];
    await Rc.setCheckedIn(e, r.id, true, "t"); await Rc.recordPayment(e, `pay${rnd()}`, [{ regId: r.id, amountYen: 500 }], "t");
    await db().collection("events").doc(e).update({ startAt: iso(NOW - 30 * H), endAt: iso(NOW - 28 * H) }); // 過去のイベントにする
    await S.setEnabled(a.id, "badminton", true); // 参加のあとにONにした
    assert.equal(await S.settleEventStamps(e), 0, "さかのぼって付けない"); assert.equal((await tapDoc(e, a)).exists, false);
    const x = await mkMember("QX"), y = await mkMember("QY"), e2 = await live({ capacity: 1 }); const tok = tokenAt(e2, NOW);
    await Q.scanReception(x.id, e2, tok); assert.equal((await Q.scanReception(y.id, e2, tok)).result, "pending");
    await db().collection("events").doc(e2).collection("registrations").doc(`qr_${y.id}`).set({ nickname: y.nickname, status: "cancelled", partySize: 1, feeYen: 500, memberId: y.id, checkedIn: false, paidYen: 0, members: [], createdAt: NOW });
    assert.equal(await Q.decideWalkin(e2, y.id, true, "admin"), "ok");
    const ry = await reg(e2, y); assert.deepEqual([ry.length, ry[0].status, ry[0].checkedIn], [1, "confirmed", true]);
  });
}
