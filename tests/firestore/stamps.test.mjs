// スタンプカード: ポイントの付与・二重付与の防止・OFF・時間外・本人以外の分離・割引の適用・タグの再発行・メンバー削除での消去。
// 実Firestore+実Next.jsで確認する(npm run test:firestore)。テスト用のデータは zz_test_ で始め、終わりに削除する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("スタンプカード", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const S = await import("@/lib/repo/stamps");
  const { hashSecret } = await import("@/lib/domain/registration");

  const rnd = () => randomBytes(4).toString("hex");
  const nick = (t = "") => `zz_test_${t}${rnd()}`.slice(0, 20);
  const PW = "テスト用パスワード-12345";
  const memberIds = [], eventIds = [], sessionHashes = [];
  const PORT = 3241, BASE = `http://127.0.0.1:${PORT}`;
  const startedAt = Date.now();
  const cfgBefore = await db().collection("stampConfig").doc("default").get();
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  after(async () => {
    proc.kill("SIGTERM");
    for (const id of memberIds) {
      const m = await db().collection("members").doc(id).get();
      if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); }
      for (const sp of ["badminton", "volleyball"]) await db().collection("stampCards").doc(`${id}_${sp}`).delete().catch(() => {});
    }
    for (const h of sessionHashes) await db().collection("memberSessions").doc(h).delete().catch(() => {});
    for (const id of eventIds) { await db().recursiveDelete(db().collection("events").doc(id)); }
    // 設定の復元(テストで書き換えた場合)
    const cfg = db().collection("stampConfig").doc("default");
    if (cfgBefore.exists) await cfg.set(cfgBefore.data()); else await cfg.delete().catch(() => {});
    const hist = await cfg.collection("history").where("at", ">=", startedAt).get(); for (const d of hist.docs) await d.ref.delete();
    const dl = await db().collection("memberDeletions").get(); for (const d of dl.docs) if (String(d.data().nickname).startsWith("zz_test_")) await d.ref.delete();
  });

  const mkMember = async (t) => { const n = nick(t); const r = await Mem.createMember(n, PW, "self"); assert.ok(r.ok, JSON.stringify(r)); memberIds.push(r.id); return { id: r.id, nickname: n }; };
  const sessionFor = async (m) => { const h = await Mem.getMemberPasswordHash(m.id); const { token } = await Mem.createMemberSession(m.id, h); sessionHashes.push(hashSecret(token)); return token; };
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  // 申込は、開始前でないとできない。そこで、最初は(これから開催)で作り、申込のあとで、ほしい時刻(offsetHours: 開始が現在から何時間後か)に直す。
  const want = {}, sportOf = {};
  const setTimes = (id, h) => { const start = new Date(Date.now() + h * 3600e3), end = new Date(start.getTime() + 2 * 3600e3); return db().collection("events").doc(id).update({ startAt: iso(start), endAt: iso(end) }); };
  const mkEvent = async ({ sport = "badminton", offsetHours = -1, status = "published", fee = 500 } = {}) => {
    const id = `zz_test_${rnd()}`; want[id] = offsetHours; sportOf[id] = sport;
    const h = offsetHours > 0 ? offsetHours : 2, start = new Date(Date.now() + h * 3600e3), end = new Date(start.getTime() + 2 * 3600e3);
    await db().collection("events").doc(id).set({ title: "【自動テスト】スタンプ", sport, venue: "テスト会場", startAt: iso(start), endAt: iso(end), feeYen: fee, capacity: 20, belongings: "", notes: "", status });
    eventIds.push(id); return id;
  };
  const apply = async (eid, m, members = []) => {
    const r = await R.createRegistration(eid, { nickname: m.nickname, members, confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id });
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  };
  // 申込がすんだら、ほしい時刻に直す(複数人が申し込んだあとに、1回だけ)。
  const settled = new Set();
  const settle = async (e) => { if (!settled.has(e)) { settled.add(e); await setTimes(e, want[e]); } };
  const tp = async (m, e) => { await settle(e); return S.tap(m.id, e, await S.currentTagToken(sportOf[e] ?? "badminton")); };
  const regOf = async (eid, m) => { const s = await db().collection("events").doc(eid).collection("registrations").where("memberId", "==", m.id).get(); return { id: s.docs[0].id, ...s.docs[0].data() }; };
  const pts = async (m, sport = "badminton") => (await S.getCards(m.id))[sport].points;
  const T = { timeout: 120_000 };

  test("付け忘れ用QR: 1個・2個が付く(申込なし・OFFでも付き、ONになる)。1イベント1回(NFCで付いた人・同時読み取りも二重にならない)。署名違い・範囲外は付かない", T, async () => {
    const { qrToken } = await import("@/lib/domain/stamps");
    const { formSecret } = await import("@/lib/repo/formtoken");
    const q = (e, n) => qrToken(formSecret(), e, n);
    const a = await mkMember("QA"), e1 = await mkEvent({ offsetHours: -48 }); await apply(e1, a); await settle(e1);
    assert.equal((await S.tapQr(a.id, e1, 2, q(e1, 1))).result, "bad", "1個用の署名を2個として使えない");
    assert.equal((await S.tapQr(a.id, e1, 1, "x".repeat(32))).result, "bad");
    assert.equal((await S.tapQr(a.id, e1, 3, q(e1, 1))).result, "invalid");
    assert.equal(await pts(a), 0);
    const r = await S.tapQr(a.id, e1, 2, q(e1, 2));
    assert.deepEqual(r, { result: "ok", sport: "badminton", points: 2, count: 2 });
    assert.equal((await S.tapQr(a.id, e1, 2, q(e1, 2))).result, "already");
    assert.equal((await S.tapQr(a.id, e1, 1, q(e1, 1))).result, "already", "同じイベントは、1個用でも付かない");
    assert.equal((await S.tap(a.id, e1, await S.currentTagToken("badminton"))).result, "already", "NFCでも、もう付かない");
    assert.equal(await pts(a), 2);
    const t = (await db().collection("events").doc(e1).collection("stampTaps").doc(a.id).get()).data();
    assert.ok(t.via === "qr" && t.count === 2 && t.pointsBefore === 0 && t.pointsAfter === 2);
    // NFCで付いた人には、QRは付かない
    const b = await mkMember("QB"), e2 = await mkEvent(); await apply(e2, b); await settle(e2); await S.setEnabled(b.id, "badminton", true);
    assert.equal((await tp(b, e2)).result, "ok");
    assert.equal((await S.tapQr(b.id, e2, 2, q(e2, 2))).result, "already");
    assert.equal(await pts(b), 1);
    // 同時に何回読んでも1回だけ
    const c = await mkMember("QC"), e3 = await mkEvent(); await apply(e3, c); await settle(e3); await S.setEnabled(c.id, "badminton", true);
    const rs = await Promise.all([1, 2, 3, 4].map(() => S.tapQr(c.id, e3, 2, q(e3, 2))));
    assert.equal(rs.filter((x) => x.result === "ok").length, 1);
    assert.equal(await pts(c), 2);
    // 申込なし・別イベント・範囲外(終了から90日より後)・開始前
    const d = await mkMember("QD");
    assert.deepEqual(await S.tapQr(d.id, e1, 1, q(e1, 1)), { result: "ok", sport: "badminton", points: 1, count: 1 }, "申込がなくても付く");
    assert.equal((await S.getCards(d.id)).badminton.enabled, true);
    d.points = 1;
    const old = await mkEvent({ offsetHours: -24 * 100 }), fut = await mkEvent({ offsetHours: 24 });
    await apply(old, d); await apply(fut, d); await settle(old); await settle(fut);
    assert.equal((await S.tapQr(d.id, old, 1, q(old, 1))).result, "late");
    assert.equal((await S.tapQr(d.id, fut, 1, q(fut, 1))).result, "early");
    assert.equal((await S.tapQr(d.id, "zz_test_not_exist", 1, q("zz_test_not_exist", 1))).result, "invalid");
    assert.equal(await pts(d), 1, "付いたのは、申込なしの1件だけ");
    // アプリを使っていない(カードがまだない)人も、QRで作られて付く
    const nw = await mkMember("QN");
    assert.equal((await S.getCards(nw.id)).badminton.points, 0);
    assert.equal((await S.tapQr(nw.id, e3, 2, q(e3, 2))).points, 2);
    assert.equal((await S.getCards(nw.id)).badminton.enabled, true);
    // いったんOFFにした人(ポイントは残る)も、QRで加算されてONに戻る
    const off = await mkMember("QO"); await S.setEnabled(off.id, "badminton", true);
    const eo1 = await mkEvent(); await apply(eo1, off); assert.equal((await tp(off, eo1)).result, "ok");
    await S.setEnabled(off.id, "badminton", false);
    const eo2 = await mkEvent({ offsetHours: -48 }); await settle(eo2);
    assert.equal((await S.tapQr(off.id, eo2, 1, q(eo2, 1))).points, 2);
    assert.equal((await S.getCards(off.id)).badminton.enabled, true);
    // 5の次は1に戻る(4ポイント+2個 → 1)
    const w = await mkMember("QW"); await S.setEnabled(w.id, "badminton", true);
    for (let i = 0; i < 4; i++) { const e = await mkEvent(); await apply(e, w); assert.equal((await tp(w, e)).result, "ok"); }
    assert.equal(await pts(w), 4);
    const ew = await mkEvent({ offsetHours: -48 }); await apply(ew, w); await settle(ew);
    assert.equal((await S.tapQr(w.id, ew, 2, q(ew, 2))).points, 1);
  });

  test("OFFでは貯まらない。ONにすると貯まり、同じイベントでは2回目は付かない", T, async () => {
    const m = await mkMember("A"), e = await mkEvent(); await apply(e, m);
    assert.equal((await tp(m, e)).result, "off", "初期はOFF");
    assert.equal(await pts(m), 0);
    assert.equal((await db().collection("events").doc(e).collection("stampTaps").doc(m.id).get()).exists, false, "OFFでは記録も残らない");
    await S.setEnabled(m.id, "badminton", true);
    assert.deepEqual(await tp(m, e), { result: "ok", sport: "badminton", points: 1 });
    assert.equal((await tp(m, e)).result, "already");
    assert.equal(await pts(m), 1);
    await S.setEnabled(m.id, "badminton", false);
    assert.equal(await pts(m), 1, "OFFにしても、これまでのポイントは残る");
  });

  test("同時に何回かざしても、付くのは1回だけ(二重付与なし)", T, async () => {
    const m = await mkMember("B"), e = await mkEvent(); await apply(e, m); await S.setEnabled(m.id, "badminton", true);
    const rs = await Promise.all(Array.from({ length: 6 }, () => tp(m, e)));
    assert.equal(rs.filter((r) => r.result === "ok").length, 1, JSON.stringify(rs));
    assert.equal(rs.filter((r) => r.result === "already").length, 5);
    assert.equal(await pts(m), 1);
  });

  test("参加確定の申込がない・キャンセル済み・待ちの人には付かない", T, async () => {
    const m = await mkMember("C"), none = await mkMember("C0"), e = await mkEvent();
    await S.setEnabled(m.id, "badminton", true); await S.setEnabled(none.id, "badminton", true);
    await apply(e, m); const reg = await regOf(e, m); await settle(e);
    assert.equal((await tp(none, e)).result, "noreg", "申込がない");
    await db().collection("events").doc(e).collection("registrations").doc(reg.id).update({ status: "cancelled" });
    assert.equal((await tp(m, e)).result, "noreg", "キャンセル済み");
    await db().collection("events").doc(e).collection("registrations").doc(reg.id).update({ status: "waitlisted" });
    assert.equal((await tp(m, e)).result, "noreg", "キャンセル待ち");
    assert.equal((await pts(m)) + (await pts(none)), 0);
  });

  test("時間外(開始の3時間より前/終了から90日より後)・対象外の競技・非公開は付かない。2日前のイベントは後づけで付く", T, async () => {
    const m = await mkMember("D"); await S.setEnabled(m.id, "badminton", true); await S.setEnabled(m.id, "volleyball", true);
    const early = await mkEvent({ offsetHours: 24 }), late = await mkEvent({ offsetHours: -24 * 100 }), past = await mkEvent({ offsetHours: -48 }), other = await mkEvent({ sport: "other" }), draft = await mkEvent({ status: "draft" });
    for (const e of [early, late, past, other, draft]) { await apply(e, m).catch(() => {}); await settle(e); }
    assert.equal((await tp(m, early)).result, "early");
    assert.equal((await tp(m, late)).result, "late");
    assert.equal((await tp(m, past)).result, "ok", "付け忘れの後づけ");
    assert.equal((await tp(m, past)).result, "already", "同じイベントは1回だけ");
    assert.equal((await tp(m, other)).result, "unsupported");
    assert.equal((await tp(m, draft)).result, "invalid");
    assert.equal((await S.tap(m.id, "zz_test_not_exist", "1.x")).result, "invalid");
    assert.equal((await S.tap(m.id, "../x", "1.x")).result, "invalid");
    assert.equal(await pts(m), 1, "付いたのは、後づけの1件だけ");
  });

  test("5ポイントの次は0に戻って、1ポイント目から貯め直す(競技ごとに別々)", T, async () => {
    const m = await mkMember("E"); await S.setEnabled(m.id, "badminton", true); await S.setEnabled(m.id, "volleyball", true);
    const got = [];
    for (let i = 0; i < 6; i++) { const e = await mkEvent(); await apply(e, m); got.push((await tp(m, e)).points); }
    assert.deepEqual(got, [1, 2, 3, 4, 5, 1]);
    const v = await mkEvent({ sport: "volleyball" }); await apply(v, m);
    assert.equal((await tp(m, v)).points, 1, "バレーボールは別の台紙");
    assert.equal(await pts(m, "badminton"), 1);
  });

  test("本人以外の分離: 他人のポイントは変わらず、チケットにも他人の情報は出ない", T, async () => {
    const a = await mkMember("F1"), b = await mkMember("F2"), e = await mkEvent();
    await apply(e, a); await apply(e, b); await S.setEnabled(a.id, "badminton", true); await S.setEnabled(b.id, "badminton", true);
    await tp(a, e);
    assert.equal(await pts(a), 1); assert.equal(await pts(b), 0, "Bのポイントは変わらない");
    const tb = (await S.getTickets(b.id)).find((t) => t.sport === "badminton");
    assert.equal(tb.tapped, false); assert.equal(tb.points, 0);
    const ta = (await S.getTickets(a.id)).find((t) => t.sport === "badminton");
    assert.equal(ta.tapped, true);
    assert.ok(!JSON.stringify(tb).includes(a.id) && !JSON.stringify(tb).includes(a.nickname), "Bのチケットに、Aの情報がない");
  });

  test("チケットの内容: 申込のある開催(会場・参加費)が出る。申込がなければ参加予定なし", T, async () => {
    const m = await mkMember("G"), e = await mkEvent({ offsetHours: 2, fee: 700 });
    assert.equal((await S.getTickets(m.id)).find((t) => t.sport === "badminton").event, null, "申込前は参加予定なし");
    await apply(e, m, ["ともだち"]);
    const t = (await S.getTickets(m.id)).find((x) => x.sport === "badminton");
    assert.deepEqual([t.event?.id, t.event?.venue, t.feeYen, t.partySize], [e, "テスト会場", 700, 2]);
    assert.equal((await S.getTickets(m.id)).find((x) => x.sport === "volleyball").event, null, "別の競技には出ない");
  });

  test("スタンプ割引: 3ポイント目の回に適用。二重適用なし・同行者あり/OFF/入金超過は拒否・金額はサーバーで計算", T, async () => {
    const m = await mkMember("H"), e = await mkEvent(); await apply(e, m); const reg = await regOf(e, m);
    await S.setEnabled(m.id, "badminton", true);
    await db().collection("stampCards").doc(`${m.id}_badminton`).update({ points: 2 });
    let d = (await S.stampDiscounts(e))[reg.id];
    assert.deepEqual([d.enabled, d.points, d.tapped, d.index, d.discountYen, d.applied], [true, 2, false, 3, 100, null]);
    assert.equal(await S.applyStampDiscount(e, reg.id, "test"), "ok");
    const after = await regOf(e, m);
    assert.deepEqual([after.feeYen, after.baseFeeYen, after.stampDiscountYen, after.stampDiscountIndex], [400, 500, 100, 3]);
    assert.equal(await S.applyStampDiscount(e, reg.id, "test"), "already");
    assert.equal((await S.stampDiscounts(e))[reg.id].applied, 100);
    // その後かざしても、割引は二重にならない(いまの回=3ポイント目のまま)
    assert.equal((await tp(m, e)).points, 3);
    assert.equal((await regOf(e, m)).feeYen, 400);
    const log = await db().collection("events").doc(e).collection("audit").where("action", "==", "stamp_discount").get();
    assert.equal(log.size, 1, "監査ログが1件");
    // 同行者あり
    const g = await mkMember("H2"), e2 = await mkEvent(); await apply(e2, g, ["とも"]); await S.setEnabled(g.id, "badminton", true);
    await db().collection("stampCards").doc(`${g.id}_badminton`).update({ points: 2 });
    assert.equal(await S.applyStampDiscount(e2, (await regOf(e2, g)).id, "test"), "group");
    // OFF
    const o = await mkMember("H3"), e3 = await mkEvent(); await apply(e3, o);
    assert.equal(await S.applyStampDiscount(e3, (await regOf(e3, o)).id, "test"), "off");
    // 割引なしの回(1ポイント目)
    const p = await mkMember("H4"), e4 = await mkEvent(); await apply(e4, p); await S.setEnabled(p.id, "badminton", true);
    assert.equal(await S.applyStampDiscount(e4, (await regOf(e4, p)).id, "test"), "no_discount");
    // 入金済みの額を下回る
    const q = await mkMember("H5"), e5 = await mkEvent(); await apply(e5, q); await S.setEnabled(q.id, "badminton", true);
    await db().collection("stampCards").doc(`${q.id}_badminton`).update({ points: 4 });
    const rq = await regOf(e5, q); await db().collection("events").doc(e5).collection("registrations").doc(rq.id).update({ paidYen: 450 });
    assert.equal(await S.applyStampDiscount(e5, rq.id, "test"), "paid", "5ポイント目の200円引き→300円は、入金済み450円を下回る");
    assert.equal((await regOf(e5, q)).feeYen, 500, "拒否のときは料金が変わらない");
    // 会計確定済み
    const r = await mkMember("H6"), e6 = await mkEvent(); await apply(e6, r); await S.setEnabled(r.id, "badminton", true);
    await db().collection("stampCards").doc(`${r.id}_badminton`).update({ points: 2 });
    await db().collection("accounting").doc(e6).set({ closed: true });
    assert.equal(await S.applyStampDiscount(e6, (await regOf(e6, r)).id, "test"), "closed");
    await db().collection("accounting").doc(e6).delete();
    // 不正なID
    assert.equal(await S.applyStampDiscount("../x", "y", "test"), "not_found");
  });

  test("割引額の設定: 不正な値は拒否(保存しない)。正しい値は保存され履歴が残る(本番の設定は変えないよう、いまと同じ値で確認)", T, async () => {
    assert.equal(await S.setTiers({ badminton: { 3: -1, 5: 200 }, volleyball: { 3: 100, 5: 200 } }, "test"), "invalid");
    assert.equal(await S.setTiers({ badminton: { 3: 100 } }, "test"), "invalid");
    assert.equal(await S.setTiers("x", "test"), "invalid");
    const before = await S.getTiers();
    assert.equal(await S.setTiers(before, "test"), "ok");
    assert.deepEqual(await S.getTiers(), before);
    const hist = await db().collection("stampConfig").doc("default").collection("history").where("at", ">=", startedAt).get();
    assert.ok(hist.size >= 1, "履歴が残る");
  });

  test("タグのURL(競技ごとに1枚): 正しいものだけ通る。別の競技のタグ・改ざんは通らない。再発行で古いURLが使えなくなる", T, async () => {
    const t1 = await S.currentTagToken("badminton"), v1 = await S.currentTagToken("volleyball");
    assert.equal(t1, await S.currentTagToken("badminton"), "毎回同じURL");
    assert.ok(/^\d+\./.test(t1));
    assert.equal(await S.verifyTag("badminton", t1), true);
    assert.equal(await S.verifyTag("volleyball", t1), false, "別の競技のタグは使えない");
    assert.equal(await S.verifyTag("badminton", v1), false);
    assert.equal(await S.verifyTag("badminton", t1.slice(0, -2) + "xx"), false);
    assert.equal(await S.verifyTag("other", t1), false, "対象外の競技");
    assert.equal(await S.bumpTagVersion("other", "test"), null);
    assert.equal(await S.bumpTagVersion("../x", "test"), null);
  });

  test("メンバーを削除すると、スタンプカードとかざした記録も消える", T, async () => {
    const m = await mkMember("I"), e = await mkEvent(); await apply(e, m); await S.setEnabled(m.id, "badminton", true); await tp(m, e);
    const tapRef = db().collection("events").doc(e).collection("stampTaps").doc(m.id), cardRef = db().collection("stampCards").doc(`${m.id}_badminton`);
    assert.equal((await tapRef.get()).exists && (await cardRef.get()).exists, true);
    assert.equal(await Mem.deleteMemberRecord(m.id, "test", 0), "ok");
    assert.equal((await tapRef.get()).exists, false); assert.equal((await cardRef.get()).exists, false);
  });

  test("複数のイベント: 割引の回は、そのイベントでかざしたときのポイントで決まる(あとの別イベントに影響されない)", T, async () => {
    const m = await mkMember("L"), x = await mkEvent(), y = await mkEvent();
    await apply(x, m); await apply(y, m); await S.setEnabled(m.id, "badminton", true);
    await db().collection("stampCards").doc(`${m.id}_badminton`).update({ points: 2 });
    assert.equal((await tp(m, x)).points, 3); assert.equal((await tp(m, y)).points, 4);
    const rx = await regOf(x, m), ry = (await db().collection("events").doc(y).collection("registrations").where("memberId", "==", m.id).get()).docs[0];
    assert.equal((await S.stampDiscounts(x))[rx.id].index, 3, "Xは3ポイント目の回のまま");
    assert.equal((await S.stampDiscounts(x))[rx.id].discountYen, 100);
    assert.equal(await S.applyStampDiscount(x, rx.id, "test"), "ok");
    assert.equal((await regOf(x, m)).feeYen, 400);
    assert.equal(await S.applyStampDiscount(y, ry.id, "test"), "no_discount", "Yは4ポイント目の回で割引なし");
  });

  test("再発行のあと、古いURLでは付かない(付与と同じトランザクションで版を確認)。テストのあとで版を元に戻す", T, async () => {
    const m = await mkMember("M"), e = await mkEvent(); await apply(e, m); await S.setEnabled(m.id, "badminton", true); await settle(e);
    const old = await S.currentTagToken("badminton");
    const hist = db().collection("stampTags").doc("badminton");
    const before = await hist.get();
    try {
      await S.bumpTagVersion("badminton", "test");
      assert.equal((await S.tap(m.id, e, old)).result, "bad");
      assert.equal((await S.tapBySport(m.id, "badminton", old)).result, "bad");
      assert.equal(await pts(m), 0);
      assert.equal((await S.tapBySport(m.id, "badminton", await S.currentTagToken("badminton"))).result, "ok");
      assert.equal((await S.tap(m.id, e, "")).result, "bad");
    } finally {
      if (before.exists) await hist.set(before.data()); else await hist.delete();
      const h = await hist.collection("history").where("at", ">=", startedAt).get(); for (const d of h.docs) await d.ref.delete();
    }
  });

  test("チケットの参加費は、割引前の額(申込時の料金)で渡し、適用済みの割引は別に返す(二重に引かない)", T, async () => {
    const m = await mkMember("N"), e = await mkEvent({ offsetHours: 2 }); await apply(e, m); await S.setEnabled(m.id, "badminton", true);
    await db().collection("stampCards").doc(`${m.id}_badminton`).update({ points: 2 });
    assert.equal(await S.applyStampDiscount(e, (await regOf(e, m)).id, "test"), "ok");
    const t = (await S.getTickets(m.id)).find((x) => x.sport === "badminton");
    assert.deepEqual([t.event?.id, t.feeYen, t.appliedDiscountYen, t.tapped, t.tapPoints], [e, 500, 100, false, null]);
  });

  test("メンバーがいなければ、カードも記録も作らない(削除と同時の設定・読み取りで残らない)", T, async () => {
    const m = await mkMember("O"), e = await mkEvent(); await apply(e, m); await S.setEnabled(m.id, "badminton", true); await settle(e);
    assert.equal(await Mem.deleteMemberRecord(m.id, "test", 0), "ok");
    assert.equal(await S.setEnabled(m.id, "badminton", true), false, "削除後は、カードを作れない");
    assert.equal((await S.tap(m.id, e, await S.currentTagToken("badminton"))).result, "invalid", "削除後は、付与できない");
    assert.equal((await db().collection("stampCards").doc(`${m.id}_badminton`).get()).exists, false);
    assert.equal((await db().collection("events").doc(e).collection("stampTaps").doc(m.id).get()).exists, false);
  });

  test("競技のタグ(毎回同じ): かざした人が申し込んでいる、開催中のイベントに付く。同時に複数あれば、開始の早い順に、未取得のものへ", T, async () => {
    const m = await mkMember("P"), x = await mkEvent({ offsetHours: -1 }), y = await mkEvent({ offsetHours: -0.5 }), other = await mkEvent({ offsetHours: -1 });
    await apply(x, m); await apply(y, m); await settle(x); await settle(y); await settle(other); // other は申し込まない
    await S.setEnabled(m.id, "badminton", true);
    const tk = await S.currentTagToken("badminton");
    assert.deepEqual(await S.tapBySport(m.id, "badminton", tk), { result: "ok", sport: "badminton", points: 1 });
    assert.equal((await db().collection("events").doc(x).collection("stampTaps").doc(m.id).get()).exists, true, "開始の早いXに付く");
    assert.deepEqual(await S.tapBySport(m.id, "badminton", tk), { result: "ok", sport: "badminton", points: 2 }, "同じタグで、次はY");
    assert.equal((await db().collection("events").doc(y).collection("stampTaps").doc(m.id).get()).exists, true);
    assert.equal((await S.tapBySport(m.id, "badminton", tk)).result, "already", "開催中の分はすべて取得済み");
    assert.equal((await db().collection("events").doc(other).collection("stampTaps").doc(m.id).get()).exists, false, "申し込んでいないイベントには付かない");
    assert.equal(await pts(m), 2);
  });

  test("競技のタグ: 開催前=early・終了から90日より後=noreg・申込なし/別の競技=noreg・OFF=off。不正な競技・署名は何もしない", T, async () => {
    const tk = await S.currentTagToken("badminton");
    const a = await mkMember("Q1"), early = await mkEvent({ offsetHours: 24 }); await apply(early, a); await S.setEnabled(a.id, "badminton", true);
    assert.equal((await S.tapBySport(a.id, "badminton", tk)).result, "early");
    const b = await mkMember("Q2"), late = await mkEvent({ offsetHours: -24 * 100 }); await apply(late, b); await settle(late); await S.setEnabled(b.id, "badminton", true);
    assert.equal((await S.tapBySport(b.id, "badminton", tk)).result, "noreg", "終了から100日たったイベントは範囲外");
    const g = await mkMember("Q6"), recent = await mkEvent({ offsetHours: -24 * 3 }); await apply(recent, g); await settle(recent); await S.setEnabled(g.id, "badminton", true);
    assert.equal((await S.tapBySport(g.id, "badminton", tk)).result, "ok", "3日前のイベントに、付け忘れの後づけ");
    assert.equal((await S.tapBySport(g.id, "badminton", tk)).result, "already");
    const c = await mkMember("Q3"); await S.setEnabled(c.id, "badminton", true);
    assert.equal((await S.tapBySport(c.id, "badminton", tk)).result, "noreg", "申込なし");
    const d = await mkMember("Q4"), vb = await mkEvent({ sport: "volleyball", offsetHours: -1 }); await apply(vb, d); await settle(vb); await S.setEnabled(d.id, "badminton", true);
    assert.equal((await S.tapBySport(d.id, "badminton", tk)).result, "noreg", "バレーの申込は、バドのタグでは付かない");
    assert.equal((await S.tapBySport(d.id, "volleyball", tk)).result, "bad", "バドのタグは、バレーには使えない");
    const f = await mkMember("Q5"), off = await mkEvent({ offsetHours: -1 }); await apply(off, f); await settle(off);
    assert.equal((await S.tapBySport(f.id, "badminton", tk)).result, "off", "ONにしていない");
    assert.equal((await S.tapBySport(f.id, "other", tk)).result, "invalid");
    assert.equal((await S.tapBySport(f.id, "badminton", "1.x")).result, "bad");
    assert.equal((await S.tapBySport("../x", "badminton", tk)).result, "invalid");
    assert.equal((await pts(a)) + (await pts(b)) + (await pts(c)) + (await pts(d)) + (await pts(f)), 0);
    assert.equal(await pts(g), 1);
  });

  test("競技のタグ: 検索の範囲(開始14日先まで・終了から90日前まで)の外は、early/late ではなく noreg(仕様)。範囲外の申込が混ざっていても、開催中のものに付く", T, async () => {
    const tk = await S.currentTagToken("badminton");
    const m2 = await mkMember("R2"), far2 = await mkEvent({ offsetHours: 24 * 15 }), old2 = await mkEvent({ offsetHours: -24 * 100 });
    await apply(far2, m2); await apply(old2, m2); await settle(far2); await settle(old2); await S.setEnabled(m2.id, "badminton", true);
    assert.equal((await S.tapBySport(m2.id, "badminton", tk)).result, "noreg", "15日先・100日前は範囲外");
    const m = await mkMember("R"), far = await mkEvent({ offsetHours: 24 * 15 }), cur = await mkEvent({ offsetHours: -1 });
    await apply(far, m); await apply(cur, m); await settle(far); await settle(cur); await S.setEnabled(m.id, "badminton", true);
    assert.equal((await S.tapBySport(m.id, "badminton", tk)).result, "ok", "範囲外の申込が混ざっていても、開催中のイベントに付く");
  });

  test("HTTP: タグのURLは、未ログインはログインへ・無効な署名は何もしない・ログイン中なら付与。画面は本人の分だけ", { timeout: 240_000 }, async () => {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/`, { redirect: "manual" }); if (r.status === 200) break; } catch {} await sleep(1000); }
    const get = (path, cookie) => fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const m = await mkMember("J"), e = await mkEvent(); await apply(e, m); await S.setEnabled(m.id, "badminton", true);
    await settle(e); const tk = await S.currentTagToken("badminton"), path = `/stamp/t/badminton/${tk}`;
    const anon = await get(path);
    assert.equal(anon.status, 307);
    assert.match(anon.headers.get("location"), new RegExp(`^/login\\?next=${encodeURIComponent(path).replaceAll(".", "\\.")}$`));
    assert.equal(anon.headers.get("referrer-policy"), "no-referrer");
    assert.match(anon.headers.get("cache-control") ?? "", /no-store/);
    const cookie = `playce_member=${await sessionFor(m)}`;
    const bad = await get(`/stamp/t/badminton/1.${"A".repeat(32)}`, cookie);
    assert.match(bad.headers.get("location"), /\?tap=bad$/);
    assert.equal(await pts(m), 0, "無効な署名では付かない");
    const ok = await get(path, cookie);
    assert.match(ok.headers.get("location"), /^\/stamp\?tap=ok&sport=badminton$/);
    assert.equal(await pts(m), 1);
    assert.match((await get(path, cookie)).headers.get("location"), /tap=already/);
    assert.equal(await pts(m), 1);
    const page = await get("/stamp?tap=ok&sport=badminton", cookie);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("PLAYCE STAMP TICKET") && html.includes("THANK"), "かざした後のチケット");
    assert.ok(!html.includes(m.id), "画面にメンバーIDを出さない");
    // アドレスを書き換えても、押されたことにはならない
    const other = await mkMember("K"); const oc = `playce_member=${await sessionFor(other)}`;
    const faked = await (await get("/stamp?tap=ok&sport=badminton", oc)).text();
    assert.ok(!faked.includes("THANK"), "押されていない人のチケットにハンコは出ない");
    assert.match((await get(`/stamp/t/other/${tk}`, cookie)).headers.get("location"), /\?tap=bad$/, "対象外の競技のタグ");
    assert.match((await get(`/stamp/t/volleyball/${tk}`, cookie)).headers.get("location"), /\?tap=bad$/, "バドのタグはバレーでは使えない");
    // ?tap= に変な値(継承プロパティ名・配列)を入れても、エラーにならない
    for (const q of ["__proto__", "constructor", "toString", "x&tap=y"]) { const r = await get(`/stamp?tap=${q}`, cookie); assert.equal(r.status, 200, q); }
    // 未ログインの画面
    const out = await (await get("/stamp")).text();
    assert.ok(out.includes("ログイン") && !out.includes("PLAYCE STAMP TICKET"));
    // 設定画面は未ログインだとログインを促す
    assert.equal((await get("/stamp/settings")).status, 200);
    // 管理画面は未ログインでログインへ
    for (const p of ["/admin/stamp"]) assert.equal((await get(p)).status, 307, p);
  });
}
