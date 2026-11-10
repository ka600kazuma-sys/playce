// 試合情報の隔離テスト(実Firestore+実際にNext.jsを起動してHTTPで確認)。
// 未公開の組み合わせ・他人の氏名/ニックネーム・主催者画面・他人のプロフィール画像は、参加者側から取得できない。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("試合情報の隔離", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const M = await import("@/lib/repo/matches");
  const Av = await import("@/lib/repo/avatars");
  const JOBSECRET = randomBytes(24).toString("hex");
  const PORT = 3238, BASE = `http://127.0.0.1:${PORT}`;
  const rnd = () => randomBytes(3).toString("hex");
  const memberIds = [], eventIds = [], sessions = [];
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", AUTO_JOB_SECRET: JOBSECRET } });
  after(async () => {
    proc.kill("SIGTERM");
    for (const id of memberIds) { const m = await db().collection("members").doc(id).get(); if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); } await db().collection("memberAvatars").doc(id).delete().catch(() => {}); }
    for (const h of sessions) await db().collection("memberSessions").doc(h).delete().catch(() => {});
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
  });
  const { hashSecret } = await import("@/lib/domain/registration");
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  const mk = async (t) => { const n = `zz_test_${t}${rnd()}`; const r = await Mem.createMemberNickOnly(n); assert.ok(r.ok); memberIds.push(r.id); const { token } = await Mem.createMemberSession(r.id); sessions.push(hashSecret(token)); return { id: r.id, nickname: n, cookie: `playce_member=${token}` }; };
  const get = async (path, cookie, init = {}) => { const r = await fetch(BASE + path, { redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) }, method: init.method }); return { status: r.status, text: await r.text(), headers: r.headers }; };

  const id = `zz_test_${rnd()}`, start = new Date(Date.now() + 30 * 60e3);
  await db().collection("events").doc(id).set({ title: "【自動テスト】隔離", sport: "badminton", venue: "テスト", startAt: iso(start), endAt: iso(new Date(start.getTime() + 2 * 3600e3)), feeYen: 0, capacity: null, belongings: "", notes: "", status: "published" });
  eventIds.push(id);
  const people = await Promise.all(["甲", "乙", "丙", "丁", "戊"].map((t) => mk(t)));
  const outsider = await mk("外");
  for (const p of people) { const r = await R.createRegistration(id, { nickname: p.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: p.id }); assert.ok(r.ok); }
  await M.saveSettings(id, { sport: "卓球", courts: 1, teamSize: 1, teams: 2, perPlayer: 2 }, "t");
  await M.syncNumbers(id); await M.regenerateDraft(id, "t");
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/matches"); break; } catch { await sleep(500); } }
  const leaks = (text) => people.filter((p) => text.includes(p.nickname)).map((p) => p.nickname);

  test("未公開の間は、誰にも(本人にも)組み合わせが出ず『まだ公開されていません』と表示される。氏名も出ない", { timeout: 180_000 }, async () => {
    for (const [c, own] of [[undefined, ""], [people[0].cookie, people[0].nickname], [outsider.cookie, outsider.nickname]]) {
      const r = await get(`/matches/${id}`, c);
      assert.equal(r.status, 200); assert.ok(r.text.includes("試合情報はまだ公開されていません")); assert.ok(!r.text.includes("<table")); assert.ok(!r.text.includes("vs"));
      assert.deepEqual(leaks(r.text).filter((n) => n !== own), []); // メニューに出る自分のニックネームは除く
    }
  });

  test("本人の参加番号は、本人だけに表示される(イベント詳細・試合情報)。未参加者・未ログインには出ない。他人の氏名は出ない", { timeout: 120_000 }, async () => {
    const mineNo = (await M.getMyNumbers(id, people[0].id)).numbers[0].number;
    for (const path of [`/events/${id}`, `/matches/${id}`]) {
      const a = await get(path, people[0].cookie);
      assert.ok(a.text.includes("あなたの参加番号"), path); assert.ok(a.text.includes(`>${mineNo}<`) || a.text.includes(String(mineNo)));
      // イベント詳細には、既存の仕様(参加表明の公開一覧: 代表者のニックネームのみ)で出る。試合情報画面には、他人のニックネームを出さない。
      if (path.startsWith("/matches")) assert.deepEqual(leaks(a.text).filter((n) => n !== people[0].nickname), [], "他人のニックネームが含まれている");
      for (const c of [undefined, outsider.cookie]) { const r = await get(path, c); assert.ok(!r.text.includes("あなたの参加番号"), `${path} 非表示`); }
    }
  });

  test("公開すると全員に番号の組み合わせが見える(氏名なし)。本人の試合は強調(色つき)。再公開で表示が更新される。編集途中は出ない", { timeout: 120_000 }, async () => {
    assert.equal(await M.publishDraft(id, "t"), "ok");
    const pub = await M.getPublicPlan(id);
    const anon = await get(`/matches/${id}`);
    assert.ok(anon.text.includes("<table") && !anon.text.includes("まだ公開されていません")); assert.deepEqual(leaks(anon.text), []);
    const mine = await get(`/matches/${id}`, people[1].cookie);
    assert.ok(mine.text.includes("bg-tint"), "本人の試合が強調される"); assert.deepEqual(leaks(mine.text).filter((n) => n !== people[1].nickname), []);
    // 下書きだけ変更 → 公開版は変わらない → 再公開で変わる
    const draft = (await M.getAdminPlan(id)).draft.matches; const e = structuredClone(draft); e[0].teams.reverse();
    assert.ok((await M.saveDraft(id, e, "t")).ok);
    const mid = await get(`/matches/${id}`); const rows = (t) => [...t.matchAll(/<tr[^>]*>.*?<\/tr>/gs)].map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).join("|");
    assert.equal(rows(mid.text), rows(anon.text), "編集途中は参加者に出ない");
    await M.publishDraft(id, "t");
    const after2 = await get(`/matches/${id}`); assert.notEqual(rows(after2.text), rows(anon.text), "再公開で更新される"); assert.equal((await M.getPublicPlan(id)).version, pub.version + 1);
  });

  test("主催者の試合管理は、未ログイン・参加者ログインではログイン画面へ。操作(Server Action)も実行できない", { timeout: 120_000 }, async () => {
    for (const c of [undefined, people[0].cookie, "playce_admin=forged"]) { const r = await get(`/admin/events/${id}/matches`, c); assert.ok([307, 308].includes(r.status) && /\/admin\/login/.test(r.headers.get("location") ?? ""), `status=${r.status}`); }
    const before = (await M.getAdminPlan(id)).draft.version;
    const form = new URLSearchParams({ keepUpTo: "0" });
    const r = await fetch(`${BASE}/admin/events/${id}/matches`, { method: "POST", body: form, redirect: "manual", headers: { cookie: people[0].cookie, origin: BASE, "next-action": "deadbeef" } });
    assert.ok(r.status >= 400 || [307, 308].includes(r.status) || r.status === 200);
    assert.equal((await M.getAdminPlan(id)).draft.version, before, "不正な操作で下書きが変わらない");
  });

  test("プロフィール画像は本人だけ。他人のIDでは取得できず、未ログインは拒否。JPEG以外・大きすぎる画像は保存されない", { timeout: 120_000 }, async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)]);
    assert.equal(await Av.setAvatar(people[0].id, jpeg), true);
    assert.equal(await Av.setAvatar(people[1].id, Buffer.from("not an image at all")), false);
    assert.equal(await Av.setAvatar(people[1].id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(200 * 1024)])), false);
    assert.equal((await get("/account/avatar")).status, 401);
    const mine = await fetch(`${BASE}/account/avatar`, { headers: { cookie: people[0].cookie } }); assert.equal(mine.status, 200); assert.equal(mine.headers.get("content-type"), "image/jpeg"); assert.equal(mine.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await get("/account/avatar", people[1].cookie)).status, 404, "他人の画像は返らない(自分の分がなければ404)");
    const noHeader = await fetch(`${BASE}/account/avatar`, { method: "DELETE", headers: { cookie: people[0].cookie } }); assert.equal(noHeader.status, 403, "CSRF対策ヘッダなしは拒否");
    assert.ok(await Av.getAvatar(people[0].id));
  });

  test("自動配布の入口: 合言葉なし・違う合言葉は拒否。正しい合言葉なら配布され、何度呼んでも番号は変わらない", { timeout: 180_000 }, async () => {
    const eid = `zz_test_${rnd()}`, st = new Date(Date.now() + 20 * 60e3);
    await db().collection("events").doc(eid).set({ title: "【自動テスト】自動配布", sport: "badminton", venue: "テスト", startAt: iso(st), endAt: iso(new Date(st.getTime() + 2 * 3600e3)), feeYen: 0, capacity: null, belongings: "", notes: "", status: "published" });
    eventIds.push(eid);
    const p = people[0];
    assert.ok((await R.createRegistration(eid, { nickname: p.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: p.id })).ok);
    const call = (auth) => fetch(`${BASE}/api/internal/auto-distribute`, { method: "POST", headers: auth ? { authorization: auth } : {} });
    for (const a of [undefined, "Bearer wrong", `Bearer ${JOBSECRET.slice(0, -1)}x`, "Bearer ", JOBSECRET]) assert.equal((await call(a)).status, 401, String(a));
    assert.equal((await fetch(`${BASE}/api/internal/auto-distribute`, { method: "GET" })).status, 405);
    assert.equal((await M.getMyNumbers(eid, p.id)).distributed, false, "拒否された呼び出しでは配布されない");
    const ok = await call(`Bearer ${JOBSECRET}`); assert.equal(ok.status, 200);
    const n1 = (await M.getMyNumbers(eid, p.id)); assert.equal(n1.distributed, true);
    for (let i = 0; i < 3; i++) assert.equal((await call(`Bearer ${JOBSECRET}`)).status, 200);
    assert.deepEqual((await M.getMyNumbers(eid, p.id)).numbers, n1.numbers, "再実行しても番号は変わらない");
  });
}
