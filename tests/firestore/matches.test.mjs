// 参加番号・試合の下書き/公開。実Firestoreで確認する(テスト用データは終了時に削除)。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("試合", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const M = await import("@/lib/repo/matches");
  const rnd = () => randomBytes(4).toString("hex");
  const memberIds = [], eventIds = [];
  after(async () => {
    for (const id of memberIds) { const m = await db().collection("members").doc(id).get(); if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); } }
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
  });
  const mkMember = async () => { const n = `zz_test_${rnd()}`.slice(0, 20); const r = await Mem.createMemberNickOnly(n); assert.ok(r.ok); memberIds.push(r.id); return { id: r.id, nickname: n }; };
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  const mkEvent = async (startInMs) => {
    const id = `zz_test_${rnd()}`, start = new Date(Date.now() + startInMs);
    await db().collection("events").doc(id).set({ title: "【自動テスト】試合", sport: "badminton", venue: "テスト", startAt: iso(start), endAt: iso(new Date(start.getTime() + 2 * 3600e3)), feeYen: 0, capacity: null, belongings: "", notes: "", status: "published" });
    eventIds.push(id); return id;
  };
  const apply = async (eid, m, members = []) => { const r = await R.createRegistration(eid, { nickname: m.nickname, members, confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id }); assert.ok(r.ok, JSON.stringify(r)); return r; };
  const numbersOf = async (eid) => (await db().collection("events").doc(eid).collection("players").get()).docs.map((d) => d.data());
  const ST = { sport: "バドミントン", courts: 2, teamSize: 2, teams: 2, perPlayer: 3 };

  test("開始1時間より前は配布しない(番号配布前)。1時間前を過ぎると配布される", async () => {
    const eid = await mkEvent(3 * 3600e3), m = await mkMember(); await apply(eid, m);
    assert.equal((await M.syncNumbers(eid)).distributed, false);
    assert.deepEqual(await M.getMyNumbers(eid, m.id), { distributed: false, numbers: [] });
    assert.equal((await M.syncNumbers(eid, { now: Date.now() + 2.5 * 3600e3 })).distributed, true);
    const mine = await M.getMyNumbers(eid, m.id); assert.equal(mine.distributed, true); assert.equal(mine.numbers.length, 1);
  });

  test("同時に何度配布しても、番号は1〜人数で重複せず、二重発行されない。同行者にも別番号。ニックネーム変更後も番号は同じ", async () => {
    const eid = await mkEvent(30 * 60e3);
    const ms = await Promise.all([mkMember(), mkMember(), mkMember()]);
    await apply(eid, ms[0], ["同行A", "同行B"]); await apply(eid, ms[1]); await apply(eid, ms[2]);
    const rs = await Promise.all(Array.from({ length: 6 }, () => M.syncNumbers(eid)));
    assert.equal(rs.filter((r) => r.first).length, 1, "初回配布は1回だけ");
    const nums = (await numbersOf(eid)).map((p) => p.number).sort((a, b) => a - b);
    assert.deepEqual(nums, [1, 2, 3, 4, 5]);
    const mine = await M.getMyNumbers(eid, ms[0].id); assert.equal(mine.numbers.length, 3);
    const before = mine.numbers.map((n) => n.number);
    assert.deepEqual((await Mem.renameMember(ms[0].id, `zz_test_${rnd()}`.slice(0, 20))).ok, true);
    assert.deepEqual((await M.getMyNumbers(eid, ms[0].id)).numbers.map((n) => n.number), before);
    await M.syncNumbers(eid); assert.deepEqual((await numbersOf(eid)).map((p) => p.number).sort((a, b) => a - b), [1, 2, 3, 4, 5], "再実行しても変わらない");
  });

  test("キャンセルした人の番号は欠番(再利用しない)。途中参加者には未使用の新しい番号。配布済みの番号は変わらない", async () => {
    const eid = await mkEvent(30 * 60e3);
    const [a, b, c, late] = await Promise.all([mkMember(), mkMember(), mkMember(), mkMember()]);
    await apply(eid, a); await apply(eid, b); await apply(eid, c);
    await M.syncNumbers(eid);
    const snapshot = Object.fromEntries((await numbersOf(eid)).map((p) => [p.label, p.number]));
    const regB = (await db().collection("events").doc(eid).collection("registrations").where("memberId", "==", b.id).get()).docs[0];
    assert.equal(await R.changeRegistrationById(eid, regB.id, "cancel", undefined, b.id), "ok");
    await apply(eid, late);
    await M.syncNumbers(eid);
    const after = await numbersOf(eid), by = Object.fromEntries(after.map((p) => [p.label, p]));
    assert.equal(by[b.nickname].active, false); assert.equal(by[b.nickname].number, snapshot[b.nickname], "キャンセルの番号は保持");
    assert.equal(by[late.nickname].number, 4, "途中参加者は新しい番号");
    for (const x of [a, c]) assert.equal(by[x.nickname].number, snapshot[x.nickname]);
    assert.equal(new Set(after.map((p) => p.number)).size, after.length);
    assert.equal((await M.getMyNumbers(eid, b.id)).numbers.length, 0, "キャンセル済みは表示しない");
  });

  test("設定・自動生成・手動修正の検証・公開/再公開。未公開の下書きは参加者向けに返らない", async () => {
    const eid = await mkEvent(30 * 60e3);
    const ms = await Promise.all(Array.from({ length: 8 }, () => mkMember()));
    for (const m of ms) await apply(eid, m);
    assert.deepEqual(await M.saveSettings(eid, ST, "t@example.com"), { ok: true });
    await M.ensureNumbers(eid); // 配布 + 自動生成(下書き)
    const admin = await M.getAdminPlan(eid);
    assert.ok(admin.distributed); assert.equal(admin.players.length, 8); assert.ok(admin.draft && admin.draft.matches.length > 0);
    assert.equal(await M.getPublicPlan(eid), null, "未公開の間は参加者に返らない");
    const again = await M.getAdminPlan(eid); await M.ensureNumbers(eid);
    assert.equal((await M.getAdminPlan(eid)).draft.version, again.draft.version, "二重実行で下書きを作り直さない");
    // 矛盾した手動修正は拒否
    const bad = structuredClone(admin.draft.matches); bad[1].round = bad[0].round; bad[1].teams[0][0] = bad[0].teams[0][0];
    const rej = await M.saveDraft(eid, bad, "t@example.com"); assert.equal(rej.ok, false);
    assert.equal((await M.getAdminPlan(eid)).draft.version, again.draft.version, "拒否したら保存されない");
    assert.equal(await M.publishDraft(eid, "t@example.com"), "ok");
    const pub1 = await M.getPublicPlan(eid); assert.equal(pub1.version, 1); assert.equal(pub1.matches.length, admin.draft.matches.length);
    // 公開後の編集は下書きに保存され、公開版は変わらない
    const edited = structuredClone(admin.draft.matches); const t0 = edited[0].teams; [t0[0][0], t0[1][0]] = [t0[1][0], t0[0][0]];
    const ok = await M.saveDraft(eid, edited, "t@example.com"); assert.ok(ok.ok, JSON.stringify(ok));
    const mid = await M.getAdminPlan(eid); assert.equal(mid.dirty, true);
    assert.deepEqual((await M.getPublicPlan(eid)).matches, pub1.matches, "編集途中は参加者に出ない");
    assert.equal(await M.publishDraft(eid, "t@example.com"), "ok");
    const pub2 = await M.getPublicPlan(eid); assert.equal(pub2.version, 2); assert.deepEqual(pub2.matches[0].teams.flat().sort(), edited[0].teams.flat().sort());
    assert.equal((await M.getAdminPlan(eid)).dirty, false);
  });

  test("当日の人数変更: 実施済みの試合を保持して、残りだけ再生成。既存の番号は変わらない", async () => {
    const eid = await mkEvent(30 * 60e3);
    const ms = await Promise.all(Array.from({ length: 8 }, () => mkMember()));
    for (const m of ms) await apply(eid, m);
    await M.saveSettings(eid, { ...ST, perPlayer: 4 }, "t"); await M.ensureNumbers(eid); await M.publishDraft(eid, "t");
    const before = (await M.getAdminPlan(eid)); const numBefore = Object.fromEntries(before.players.map((p) => [p.label, p.number]));
    const done = before.draft.matches.filter((m) => m.round <= 2);
    const regLast = (await db().collection("events").doc(eid).collection("registrations").where("memberId", "==", ms[7].id).get()).docs[0];
    assert.equal(await R.changeRegistrationById(eid, regLast.id, "cancel", undefined, ms[7].id), "ok");
    const nw = await mkMember(); await apply(eid, nw); await apply(eid, await mkMember());
    await M.syncNumbers(eid);
    const out = await M.regenerateDraft(eid, "t", done.length); assert.ok(out.ok, JSON.stringify(out));
    const aft = await M.getAdminPlan(eid);
    assert.deepEqual(aft.draft.matches.slice(0, done.length), done, "実施済みは保持");
    const rest = aft.draft.matches.slice(done.length); const cancelledNo = numBefore[ms[7].nickname];
    assert.ok(rest.every((m) => !m.teams.flat().includes(cancelledNo)));
    for (const p of aft.players) if (numBefore[p.label] !== undefined) assert.equal(p.number, numBefore[p.label]);
    assert.equal((await M.getPublicPlan(eid)).matches.length, before.draft.matches.length, "再公開するまで、公開版は変わらない");
  });
}
