// 公開の参加者一覧: 実Firestore+実Next.jsで、画面(HTML)に出てよい情報だけが出ることを確認する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("参加者一覧", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const R = await import("@/lib/repo/registrations");
  const P = await import("@/lib/repo/reception");
  const PORT = 3233, BASE = `http://127.0.0.1:${PORT}`;
  const rnd = () => randomBytes(4).toString("hex");
  const start = new Date(Date.now() + 9 * 864e5), end = new Date(start.getTime() + 2 * 3600e3);
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  const ym = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(start).slice(0, 7);
  const id = `zz_test_${rnd()}`;
  const N = { a: `参加者甲${rnd()}`, hidden: `隠す乙${rnd()}`, cancelled: `取消丙${rnd()}`, comp: `同行者秘密${rnd()}`, draft: `下書き丁${rnd()}` };
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  const draftId = `zz_test_${rnd()}`;
  after(async () => { proc.kill("SIGTERM"); for (const x of [id, draftId]) await db().recursiveDelete(db().collection("events").doc(x)); });

  const ev = (status) => ({ title: "【自動テスト】参加者一覧", sport: "badminton", venue: "テスト", startAt: iso(start), endAt: iso(end), feeYen: 500, capacity: null, belongings: "", notes: "", status });
  await db().collection("events").doc(id).set(ev("published"));
  await db().collection("events").doc(draftId).set(ev("draft"));
  const apply = (eid, nickname, members = []) => R.createRegistration(eid, { nickname, members, confirmDuplicate: false }, `b-${rnd()}${rnd()}`);
  const a = await apply(id, N.a, [N.comp]), h = await apply(id, N.hidden), c = await apply(id, N.cancelled);
  assert.ok(a.ok && h.ok && c.ok);
  // 下書きのイベントは申込を受け付けないため、確認用の申込データを直接作る
  await db().collection("events").doc(draftId).collection("registrations").doc(`zz${rnd()}`).set({ nickname: N.draft, members: [], partySize: 1, status: "confirmed", feeYen: 500, checkedIn: false, paidYen: 0, source: "web", offerExpiresAt: null, createdAt: Date.now(), updatedAt: Date.now() });
  assert.equal(await R.changeRegistration(id, c.token, "cancel"), "ok");
  const regs = await P.listRegs(id); const hid = regs.find((x) => x.nickname === N.hidden);
  assert.equal(await P.setPublicHidden(id, hid.id, true, "test"), "ok");
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/contact"); break; } catch { await sleep(500); } }
  const html = async (p) => (await fetch(BASE + p)).text();

  test("カレンダーとイベント詳細に、参加確定の代表者名と人数が出る(隠した人・同行者・取消・下書きのイベントの人・トークンは出ない)", { timeout: 180_000 }, async () => {
    for (const path of [`/?m=${ym}`, `/events/${id}`]) {
      const t = await html(path);
      assert.ok(t.includes(N.a), `${path}: 代表者名が出ていない`);
      assert.ok(t.includes("参加表明") || path.startsWith("/?m="), path);
      for (const [k, v] of Object.entries({ hidden: N.hidden, cancelled: N.cancelled, comp: N.comp, draft: N.draft })) assert.ok(!t.includes(v), `${path}: ${k} が漏れている`);
      for (const tok of [a.token, h.token, c.token]) assert.ok(!t.includes(tok), `${path}: トークンが漏れている`);
      assert.ok(!t.includes("browserHash") && !t.includes("paidYen"), path);
    }
    const detail = await html(`/events/${id}`);
    assert.ok(/参加表明\s*(<!--\s*-->)?\s*3\s*(<!--\s*-->)?\s*人/.test(detail) || detail.includes("参加表明"), "人数の表示");
    assert.ok(detail.includes("ほか"), "隠した人・同行者は「ほか N人」にまとまる");
  });

  test("一覧表示(view=list)・下書きのイベントの詳細からは、参加者名が出ない", { timeout: 120_000 }, async () => {
    const list = await html(`/?m=${ym}&view=list`); assert.ok(!list.includes(N.a));
    const draft = await fetch(`${BASE}/events/${draftId}`); assert.equal(draft.status, 404); assert.ok(!(await draft.text()).includes(N.draft));
  });

  test("主催者が「表示する」に戻すと、名前が出る(いったん隠した人も人数は含まれていた)", { timeout: 120_000 }, async () => {
    assert.equal(await P.setPublicHidden(id, hid.id, false, "test"), "ok");
    assert.ok((await html(`/events/${id}`)).includes(N.hidden));
    assert.equal(await P.setPublicHidden(id, hid.id, true, "test"), "ok");
    assert.ok(!(await html(`/events/${id}`)).includes(N.hidden));
    assert.equal(await P.setPublicHidden("../x", "y", true, "test"), "not_found");
  });
}
