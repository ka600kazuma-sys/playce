// 実 Firestore(playce-e1455)に対する統合テスト。ADC(gcloud auth application-default login)が必要。
// 実行: npm run test:firestore   専用のテストイベントを作り、終了時に削除する(他のデータには触れない)。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("実Firestore統合テスト", { skip: "RUN_FIRESTORE_TESTS=1 かつエミュレータ未使用のときだけ実行(npm run test:firestore)" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const R = await import("@/lib/repo/registrations");
  const P = await import("@/lib/repo/reception");
  const A = await import("@/lib/repo/accounting");
  const M = await import("@/lib/repo/messages");
  const { hashSecret } = await import("@/lib/domain/registration");
  const threads = [];

  const created = [];
  const mkEvent = async (capacity, feeYen = 500) => {
    const id = `zz_test_${randomBytes(6).toString("hex")}`;
    await db().collection("events").doc(id).set({
      title: "【自動テスト】削除されます", sport: "badminton", venue: "テスト", startAt: new Date(Date.now() + 7 * 864e5).toISOString().replace("Z", "+00:00"),
      endAt: new Date(Date.now() + 7 * 864e5 + 2 * 3600e3).toISOString().replace("Z", "+00:00"), feeYen, capacity, belongings: "", notes: "", status: "published",
    });
    created.push(id); return id;
  };
  const apply = (id, n) => R.createRegistration(id, { nickname: `テスト${n}`, members: [], confirmDuplicate: false }, `browser-${randomBytes(8).toString("hex")}`);
  const regsOf = async (id) => (await P.listRegs(id));
  const count = (rows, st) => rows.filter((r) => r.status === st).reduce((n, r) => n + r.partySize, 0);

  after(async () => { for (const id of threads) await db().recursiveDelete(db().collection("messages").doc(id)); for (const id of created) { await db().recursiveDelete(db().collection("events").doc(id)); await db().collection("accounting").doc(id).delete().catch(() => {}); } });

  test("B8 同時申込8件・定員3: 確定は3人を超えず、残りはキャンセル待ち", { timeout: 120_000 }, async () => {
    const id = await mkEvent(3);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => apply(id, i)));
    assert.ok(rs.every((r) => r.ok));
    const rows = await regsOf(id);
    assert.equal(rows.length, 8); assert.equal(count(rows, "confirmed"), 3); assert.equal(count(rows, "waitlisted"), 5);
  });

  test("B8 同時キャンセル2件+同じ申込の二重キャンセル: 二重に繰り上げない(提示は空き枠の数だけ)", { timeout: 120_000 }, async () => {
    const id = await mkEvent(3);
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push(await apply(id, i)); // 順番を確定させるため直列で申込
    const confirmed = rs.slice(0, 3);
    assert.deepEqual(rs.map((r) => r.status), ["confirmed", "confirmed", "confirmed", "waitlisted", "waitlisted", "waitlisted"]);
    const out = await Promise.all([
      R.changeRegistration(id, confirmed[0].token, "cancel"), R.changeRegistration(id, confirmed[0].token, "cancel"), // 同じ申込を二重に
      R.changeRegistration(id, confirmed[1].token, "cancel"),
    ]);
    assert.equal(out.filter((x) => x === "ok").length, 2); // 二重分は invalid_state
    const rows = await regsOf(id);
    assert.equal(count(rows, "confirmed"), 1); assert.equal(count(rows, "offered"), 2); assert.equal(count(rows, "waitlisted"), 1);
    assert.ok(count(rows, "confirmed") + count(rows, "offered") <= 3);
  });

  test("A3 他人の申込: 推測した管理URL・他イベントのトークン・他人のトークンでは閲覧も変更もできない", { timeout: 120_000 }, async () => {
    const e1 = await mkEvent(null), e2 = await mkEvent(null);
    const a = await apply(e1, "A"), b = await apply(e1, "B");
    assert.ok(a.ok && b.ok);
    assert.equal((await R.getMyRegistration(e1, a.token)).nickname, "テストA");
    assert.equal((await R.getMyRegistration(e1, b.token)).nickname, "テストB");
    assert.equal(await R.getMyRegistration(e1, randomBytes(32).toString("base64url")), null); // 推測
    assert.equal(await R.getMyRegistration(e2, a.token), null);                                 // 別イベントでの流用
    assert.equal(await R.getMyRegistration(e1, "short"), null);
    assert.equal(await R.changeRegistration(e1, randomBytes(32).toString("base64url"), "cancel"), "not_found");
    assert.equal(await R.changeRegistration(e2, a.token, "cancel"), "not_found");
    assert.equal((await R.getMyRegistration(e1, a.token)).status, "confirmed"); // 変わっていない
    // 保存されているのはトークンのハッシュで、トークンそのものではない
    const ids = (await db().collection("events").doc(e1).collection("registrations").get()).docs.map((d) => d.id);
    assert.ok(!ids.includes(a.token) && !ids.includes(b.token));
  });

  test("D4 入金: 同じ冪等性キーの再送・同時送信で二重計上しない/残額超過は拒否/取消は一度だけ戻す", { timeout: 120_000 }, async () => {
    const id = await mkEvent(null, 500);
    const r = await apply(id, "pay"); assert.ok(r.ok);
    const regId = (await regsOf(id))[0].id;
    const key = `k${randomBytes(8).toString("hex")}`;
    const res = await Promise.all(Array.from({ length: 5 }, () => P.recordPayment(id, key, [{ regId, amountYen: 300 }], "test")));
    assert.ok(res.every((x) => x === "ok"));
    assert.equal((await regsOf(id))[0].paidYen, 300);                       // 1回分だけ
    assert.equal((await P.listPayments(id)).length, 1);
    assert.equal(await P.recordPayment(id, `k${randomBytes(8).toString("hex")}`, [{ regId, amountYen: 300 }], "test"), "invalid"); // 600 > 500
    assert.equal(await P.recordPayment(id, `k${randomBytes(8).toString("hex")}`, [{ regId, amountYen: 200 }], "test"), "ok");
    assert.equal((await regsOf(id))[0].paidYen, 500);
    await Promise.all([P.voidPayment(id, key, "テスト取消", "test"), P.voidPayment(id, key, "テスト取消", "test")]);
    assert.equal((await regsOf(id))[0].paidYen, 200);                       // 300 が1回だけ戻る
  });

  test("D4 経費: 同じ冪等性キーの再送・同時送信で二重計上しない/会計確定中は入金・経費を拒否", { timeout: 120_000 }, async () => {
    const id = await mkEvent(null, 500);
    const key = `e${randomBytes(8).toString("hex")}`;
    const res = await Promise.all(Array.from({ length: 4 }, () => A.addExpense(id, key, { category: "会場費", description: "テスト", amountYen: 2850 }, "test")));
    assert.ok(res.every((x) => x === "ok"));
    const ex = await A.listExpenses(id); assert.equal(ex.length, 1); assert.equal(ex[0].amountYen, 2850);
    const r = await apply(id, "x"); assert.ok(r.ok); const regId = (await regsOf(id))[0].id;
    assert.equal(await A.setClosed(id, true, "", "test"), "invalid"); // 開催前は確定できない
    const past = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace("Z", "+00:00");
    await db().collection("events").doc(id).update({ startAt: past(5), endAt: past(3) }); // 終了済みに変更(テスト用の細工)
    assert.equal(await A.setClosed(id, true, "", "test"), "ok");
    assert.equal(await A.addExpense(id, `e${randomBytes(8).toString("hex")}`, { category: "会場費", description: "確定後", amountYen: 100 }, "test"), "closed");
    assert.equal(await P.recordPayment(id, `k${randomBytes(8).toString("hex")}`, [{ regId, amountYen: 100 }], "test"), "closed");
  });

  test("メッセージ: 送信→主催者の既読/返信/状態、他人のトークンでは読めない、同時投稿でも件数が合う", { timeout: 120_000 }, async () => {
    const a = await M.createThread({ nickname: "zz_test_A", body: "質問Aです" }, null), b = await M.createThread({ nickname: "zz_test_B", body: "質問Bです" }, "テストイベント");
    threads.push(hashSecret(a.token), hashSecret(b.token));
    const ta = await M.getThreadByToken(a.token), tb = await M.getThreadByToken(b.token);
    assert.equal(ta.posts.length, 1); assert.equal(ta.posts[0].body, "質問Aです"); assert.equal(tb.thread.eventTitle, "テストイベント");
    assert.ok(!JSON.stringify(ta).includes("質問Bです"));                       // 他人のスレッドの内容は含まれない
    assert.equal(await M.getThreadByToken(randomBytes(32).toString("base64url")), null); // 推測
    assert.equal(await M.getThreadByToken("short"), null);
    assert.equal(await M.addParticipantPost(randomBytes(32).toString("base64url"), "x"), "not_found");
    // 主催者側: 未読が付いており、開くと既読になる。返信すると「対応中」+参加者に未読の返信
    assert.ok((await M.unreadCount()) >= 2);
    const idA = hashSecret(a.token);
    assert.equal((await M.listThreads()).find((t) => t.id === idA).unreadByAdmin, true);
    assert.equal((await M.openThreadAsAdmin(idA)).thread.unreadByAdmin, false);
    assert.equal((await M.listThreads()).find((t) => t.id === idA).unreadByAdmin, false);
    assert.equal(await M.addOrganizerPost(idA, "回答します"), "ok");
    let l = (await M.listThreads()).find((t) => t.id === idA);
    assert.deepEqual([l.status, l.unreadByParticipant, l.lastFrom, l.postCount], ["inprogress", true, "organizer", 2]);
    const seen = await M.getThreadByToken(a.token);                              // 参加者が開く → 既読
    assert.deepEqual(seen.posts.map((p) => p.from), ["participant", "organizer"]);
    assert.equal((await M.listThreads()).find((t) => t.id === idA).unreadByParticipant, false);
    // 完了→参加者の再投稿で未対応に戻る
    assert.equal(await M.setThreadStatus(idA, "done"), "ok");
    assert.equal(await M.addParticipantPost(a.token, "追加の質問"), "ok");
    l = (await M.listThreads()).find((t) => t.id === idA); assert.deepEqual([l.status, l.unreadByAdmin], ["open", true]);
    // 同時に5件投稿しても、全て残り件数が合う
    const out = await Promise.all(Array.from({ length: 5 }, (_, i) => M.addParticipantPost(a.token, `同時${i}`)));
    assert.ok(out.every((x) => x === "ok"));
    const fin = await M.getThreadByToken(a.token); assert.equal(fin.posts.length, 8); assert.equal(fin.thread.postCount, 8);
    assert.equal(await M.addOrganizerPost("zz" + "0".repeat(62), "x"), "not_found");
    assert.equal(await M.setThreadStatus("nope", "done"), "not_found");
  });
}

