// 参加者アカウント(ニックネーム+パスワード)・メンバーに紐づく申込・主催者による追加/削除。実Firestore+実Next.jsで確認する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("メンバー", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const P = await import("@/lib/repo/reception");
  const Part = await import("@/lib/repo/participants");
  const { hashSecret } = await import("@/lib/domain/registration");

  const rnd = () => randomBytes(4).toString("hex");
  const nick = (t = "") => `zz_test_${t}${rnd()}`.slice(0, 20);
  const PW = "テスト用パスワード-12345";
  const memberIds = [], eventIds = [], sessionHashes = [];
  const PORT = 3237, BASE = `http://127.0.0.1:${PORT}`;
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  after(async () => {
    proc.kill("SIGTERM");
    for (const id of memberIds) { const m = await db().collection("members").doc(id).get(); if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); } }
    for (const h of sessionHashes) await db().collection("memberSessions").doc(h).delete().catch(() => {});
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
    const dl = await db().collection("memberDeletions").get(); for (const d of dl.docs) if (String(d.data().nickname).startsWith("zz_test_")) await d.ref.delete();
  });

  const mkMember = async (t) => { const n = nick(t); const r = await Mem.createMember(n, PW, "self"); assert.ok(r.ok, JSON.stringify(r)); memberIds.push(r.id); return { id: r.id, nickname: n }; };
  const sessionFor = async (m) => { const h = await Mem.getMemberPasswordHash(m.id); const { token } = await Mem.createMemberSession(m.id, h); sessionHashes.push(hashSecret(token)); return token; };
  const start = new Date(Date.now() + 8 * 864e5), end = new Date(start.getTime() + 2 * 3600e3), iso = (d) => d.toISOString().replace("Z", "+00:00");
  const mkEvent = async (capacity, status = "published") => {
    const id = `zz_test_${rnd()}`;
    await db().collection("events").doc(id).set({ title: "【自動テスト】メンバー", sport: "badminton", venue: "テスト", startAt: iso(start), endAt: iso(end), feeYen: 500, capacity, belongings: "", notes: "", status });
    eventIds.push(id); return id;
  };
  const apply = (eid, m, members = []) => R.createRegistration(eid, { nickname: m.nickname, members, confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id });
  const statusOf = async (eid, rid) => (await db().collection("events").doc(eid).collection("registrations").doc(rid).get()).data().status;

  test("登録: 同じニックネーム(大文字小文字・全角半角違い含む)は登録できない/弱いパスワード・不正なニックネームは拒否", { timeout: 120_000 }, async () => {
    const a = await mkMember("A");
    for (const dup of [a.nickname, a.nickname.toUpperCase(), a.nickname.toLowerCase(), ` ${a.nickname} `]) { const r = await Mem.createMember(dup, PW, "self"); assert.deepEqual([r.ok, r.code], [false, "taken"], dup); }
    assert.equal((await Mem.createMember(nick("B"), "short", "self")).code, "invalid");
    assert.equal((await Mem.createMember("<script>", PW, "self")).code, "invalid");
    const same = nick("C"); assert.equal((await Mem.createMember(same, same, "self")).code, "invalid"); // パスワードがニックネームと同じ
    // 同時に同じニックネームで登録しても、1人だけ
    const n = nick("D"); const rs = await Promise.all([1, 2, 3, 4].map(() => Mem.createMember(n, PW, "self")));
    rs.filter((r) => r.ok).forEach((r) => memberIds.push(r.id)); assert.equal(rs.filter((r) => r.ok).length, 1);
    // DBにパスワードそのものは保存されない
    const doc = (await db().collection("members").doc(a.id).get()).data(); assert.ok(!JSON.stringify(doc).includes(PW)); assert.match(doc.passwordHash, /^scrypt\$/);
  });

  test("ログイン: 正しいニックネーム+パスワードだけ/存在しないニックネーム・違うパスワードは拒否(区別しない)", { timeout: 120_000 }, async () => {
    const a = await mkMember("L");
    assert.equal((await Mem.authenticateMember(a.nickname, PW))?.id, a.id);
    assert.equal((await Mem.authenticateMember(a.nickname.toUpperCase(), PW))?.id, a.id);        // 大文字小文字の違いは同じ扱い
    for (const [n, p] of [[a.nickname, PW + "x"], [a.nickname, ""], [nick("none"), PW], ["", PW], ["<x>", PW], [a.nickname, "x".repeat(500)]]) assert.equal(await Mem.authenticateMember(n, p), null);
  });

  test("セッション: ログイン中だけ有効/削除・期限切れ・パスワード変更・メンバー削除で無効/偽や改変は無効", { timeout: 120_000 }, async () => {
    const a = await mkMember("S"); const t1 = await sessionFor(a);
    assert.equal((await Mem.getMemberBySession(t1)).id, a.id);
    for (const bad of [t1.slice(0, -1), t1 + "A", hashSecret(t1), randomBytes(32).toString("base64url"), "forged", ""]) assert.equal(await Mem.getMemberBySession(bad), null);
    await Mem.deleteMemberSession(t1); assert.equal(await Mem.getMemberBySession(t1), null);          // ログアウト
    const t2 = await sessionFor(a); await db().collection("memberSessions").doc(hashSecret(t2)).update({ expiresAt: Date.now() - 1000 });
    assert.equal(await Mem.getMemberBySession(t2), null);                                                // 期限切れ
    const t3 = await sessionFor(a), t4 = await sessionFor(a);
    const ch = await Mem.changeMemberPassword(a.id, PW, "新しいパスワード-98765"); assert.ok(ch.ok && ch.passwordHash);
    assert.equal(await Mem.getMemberBySession(t3), null); assert.equal(await Mem.getMemberBySession(t4), null); // 変更後は、すべての端末が無効
    assert.equal(await Mem.authenticateMember(a.nickname, PW), null); assert.ok(await Mem.authenticateMember(a.nickname, "新しいパスワード-98765"));
    assert.equal((await Mem.changeMemberPassword(a.id, "wrong-current-pw", "another-pass-123")).ok, false);
    const t5 = await Mem.createMemberSession(a.id, ch.passwordHash); sessionHashes.push(hashSecret(t5.token)); assert.ok(await Mem.getMemberBySession(t5.token));
    assert.equal(await Mem.deleteMemberRecord(a.id, "test", 0), "ok"); assert.equal(await Mem.getMemberBySession(t5.token), null); // メンバー削除後は無効
  });

  test("ニックネーム変更: 他人が使っているものは不可/自分の旧名は解放/ログインは新しい名前/一覧・名簿は新しい名前で表示", { timeout: 120_000 }, async () => {
    const a = await mkMember("R1"), b = await mkMember("R2");
    assert.equal((await Mem.renameMember(a.id, b.nickname)).ok, false);
    const nn = nick("R3"); assert.ok((await Mem.renameMember(a.id, nn)).ok);
    assert.ok(await Mem.authenticateMember(nn, PW)); assert.equal(await Mem.authenticateMember(a.nickname, PW), null);
    assert.ok((await Mem.createMember(a.nickname, PW, "self")).ok && (memberIds.push((await Mem.authenticateMember(a.nickname, PW)).id), true)); // 旧名は他の人が使える
    assert.ok((await Mem.renameMember(a.id, nn.toUpperCase())).ok);                                          // 大文字小文字だけの変更は自分なら可
    const ev = await mkEvent(null); assert.ok((await apply(ev, { id: a.id, nickname: nn })).ok);
    assert.ok((await Part.listPublicParticipants([ev]))[ev].names.includes(nn.toUpperCase()));              // 公開の参加者一覧も、いまのニックネーム
    assert.equal((await P.listRegs(ev))[0].nickname, nn.toUpperCase());                                       // 主催者の名簿も同じ
  });

  test("申込: メンバーは1イベント1申込/他人の申込は操作できない/本人の取消で待ちが繰り上がる/どの端末でも本人の申込が見える", { timeout: 120_000 }, async () => {
    const a = await mkMember("P1"), b = await mkMember("P2"), c = await mkMember("P3");
    const ev = await mkEvent(1);
    const ra = await apply(ev, a), again = await apply(ev, a);
    assert.equal(ra.ok, true); assert.deepEqual([again.ok, again.code], [false, "already"]);
    const rb = await apply(ev, b); assert.equal(rb.status, "waitlisted");
    const mineA = await R.getMemberRegistration(ev, a.id), mineB = await R.getMemberRegistration(ev, b.id);
    assert.equal(mineA.nickname, a.nickname); assert.equal(mineB.nickname, b.nickname); assert.equal(await R.getMemberRegistration(ev, c.id), null);
    assert.equal(await R.changeRegistrationById(ev, mineA.regId, "cancel", undefined, b.id), "not_found");   // 他人のメンバーIDでは、操作できない
    assert.equal(await R.changeRegistrationById(ev, mineA.regId, "cancel", undefined, c.id), "not_found");
    assert.equal((await R.getMemberRegistration(ev, a.id)).status, "confirmed");
    assert.equal(await R.changeRegistrationById(ev, mineA.regId, "cancel", undefined, a.id), "ok");           // 本人は取消できる
    assert.equal((await R.getMemberRegistration(ev, b.id)).status, "offered");                                // 待ちが繰り上がる
    assert.deepEqual((await R.listMemberRegistrations(b.id, [{ id: ev }])).map((x) => x.event.id), [ev]);
    assert.equal(await apply(ev, a).then((r) => r.ok), true);                                                  // 取消後は、また申込める
  });

  test("主催者: メンバーを参加者に追加(定員に関係なく確定・二重追加は不可)/削除(取消)で繰り上げ・入金済みは不可", { timeout: 120_000 }, async () => {
    const a = await mkMember("O1"), b = await mkMember("O2"), c = await mkMember("O3");
    const ev = await mkEvent(1);
    await apply(ev, a); const rb = await apply(ev, b); assert.equal(rb.status, "waitlisted");
    assert.equal(await R.adminAddRegistration(ev, { memberId: c.id, nickname: c.nickname, partySize: 2 }, "admin@test"), "ok");   // 満員でも追加できる
    assert.equal(await R.adminAddRegistration(ev, { memberId: c.id, nickname: c.nickname, partySize: 1 }, "admin@test"), "duplicate");
    assert.equal(await R.adminAddRegistration(ev, { memberId: "../x", nickname: "x", partySize: 1 }, "admin@test"), "not_found");
    assert.equal(await R.adminAddRegistration(ev, { nickname: "x", partySize: 99 }, "admin@test"), "invalid_state");
    const rc = await R.getMemberRegistration(ev, c.id); assert.deepEqual([rc.status, rc.partySize], ["confirmed", 2]);
    const ra = await R.getMemberRegistration(ev, a.id);
    assert.equal(await R.adminCancelRegistration(ev, ra.regId, "admin@test"), "ok");                       // 削除(取消)
    assert.equal(await R.adminCancelRegistration(ev, ra.regId, "admin@test"), "invalid_state");             // 二重取消は何も起きない
    assert.equal(await R.adminCancelRegistration(ev, "nope", "admin@test"), "not_found");
    const regs = await P.listRegs(ev); assert.ok(regs.find((r) => r.nickname === c.nickname));
    const paidId = rc.regId;
    assert.equal(await P.recordPayment(ev, `k${rnd()}${rnd()}`, [{ regId: paidId, amountYen: 500 }], "test"), "ok");
    assert.equal(await R.adminCancelRegistration(ev, paidId, "admin@test"), "paid");                         // 入金済みは取消できない
    assert.equal((await R.getMemberRegistration(ev, c.id)).status, "confirmed");
    const audits = (await db().collection("events").doc(ev).collection("audit").get()).docs.map((d) => d.data().action);
    assert.ok(audits.includes("admin_add") && audits.includes("admin_cancel"));                              // 操作の記録が残る
  });

  test("主催者: メンバー削除は、これからの申込を取り消して、ニックネームを解放する", { timeout: 120_000 }, async () => {
    const a = await mkMember("D1"); const ev = await mkEvent(null); await apply(ev, a);
    const up = await R.upcomingMemberRegistrations(a.id); assert.equal(up.length, 1); assert.equal(up[0].paidYen, 0);
    let n = 0; for (const u of up) if ((await R.adminCancelRegistration(u.eventId, u.regId, "admin@test")) === "ok") n++;
    assert.equal(await Mem.deleteMemberRecord(a.id, "admin@test", n), "ok");
    assert.equal(await Mem.deleteMemberRecord(a.id, "admin@test", 0), "not_found");
    assert.equal(await Mem.authenticateMember(a.nickname, PW), null);
    assert.equal((await db().collection("nicknames").doc((await import("@/lib/domain/member")).nicknameKey(a.nickname)).get()).exists, false);
    assert.equal((await Part.listPublicParticipants([ev]))[ev].total, 0);
    const log = await db().collection("memberDeletions").where("memberId", "==", a.id).get(); assert.equal(log.size, 1); assert.equal(log.docs[0].data().cancelledRegistrations, 1);
    assert.equal(await Mem.deleteMemberRecord("../x", "t", 0), "not_found");
  });

  test("画面(HTTP): 申込・アカウント・申込の確認はログインが必要/偽Cookieは無効/他人の申込は見えない/参加者のCookieでは管理画面に入れない", { timeout: 240_000 }, async () => {
    for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/login"); break; } catch { await sleep(500); } }
    const a = await mkMember("H1"), b = await mkMember("H2"); const ev = await mkEvent(null);
    assert.ok((await apply(ev, a, [`同行者秘密${rnd()}`])).ok); assert.ok((await apply(ev, b)).ok);
    const ta = await sessionFor(a);
    const get = (p, cookie) => fetch(BASE + p, { redirect: "manual", headers: cookie ? { cookie: `playce_member=${cookie}` } : {} });
    const toLogin = async (p, cookie) => { const r = await get(p, cookie); return [307, 308].includes(r.status) && /\/login\?next=/.test(r.headers.get("location") ?? ""); };
    for (const p of [`/events/${ev}/apply`, `/events/${ev}/mine`, "/account"]) { assert.ok(await toLogin(p), p); assert.ok(await toLogin(p, "forged"), p); assert.ok(await toLogin(p, ta.slice(0, -1) + (ta.endsWith("A") ? "B" : "A")), p); }
    assert.equal((await get("/login")).status, 200); assert.equal((await get("/signup")).status, 200);
    const apply_ = await (await get(`/events/${ev}/apply`, ta)).text(); assert.ok(apply_.includes(a.nickname)); assert.ok(!apply_.includes(b.nickname));
    const mine = await (await get(`/events/${ev}/mine`, ta)).text(); assert.ok(mine.includes(a.nickname)); assert.ok(!mine.includes(b.nickname) && !mine.includes("scrypt$"));
    const acc = await (await get("/account", ta)).text(); assert.ok(acc.includes(a.nickname) && !acc.includes(b.nickname) && !acc.includes("scrypt$"));
    const me = await (await get("/me", ta)).text(); assert.ok(me.includes("自分の参加予定") && !me.includes(b.nickname));
    for (const p of ["/admin", "/admin/members", `/admin/events/${ev}/reception`]) { const r = await fetch(BASE + p, { redirect: "manual", headers: { cookie: `playce_member=${ta}` } }); assert.ok([307, 308].includes(r.status) && /\/admin\/login/.test(r.headers.get("location") ?? ""), p); }
    const cal = await (await get("/")).text(); assert.ok(!cal.includes("scrypt$"));
    await Mem.deleteMemberSession(ta); assert.ok(await toLogin(`/events/${ev}/apply`, ta));                  // ログアウト後は、もう入れない
  });
}
