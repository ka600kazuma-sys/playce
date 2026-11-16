// 会場の地図リンク: 登録・更新・削除、画面でのリンク(イベント詳細・カレンダー)、不正なURLの拒否。実Firestore+実Next.jsで確認する。
// テスト用のデータは zz_test_ で始め、終わりに削除する(本番に登録された会場には触れない)。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("会場", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const V = await import("@/lib/repo/venues");
  const { venueKey, searchUrl } = await import("@/lib/domain/venues");
  const rnd = () => randomBytes(3).toString("hex");
  const PORT = 3242, BASE = `http://127.0.0.1:${PORT}`;
  const eventIds = [], names = [];
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  after(async () => {
    proc.kill("SIGTERM");
    for (const v of await V.listVenues()) if (v.name.startsWith("zz_test_")) await V.deleteVenue(v.id, "test");
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
    const hs = await db().collection("venues").get();
    for (const d of hs.docs) if (String(d.data().name ?? "").startsWith("zz_test_")) await db().recursiveDelete(d.ref);
  });
  const T = { timeout: 120_000 };
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  const mkEvent = async (venue, hours = 1) => {
    const id = `zz_test_${rnd()}`, start = new Date(Date.now() + hours * 3600e3);
    await db().collection("events").doc(id).set({ title: "【自動テスト】会場", sport: "badminton", venue, startAt: iso(start), endAt: iso(new Date(start.getTime() + 2 * 3600e3)), feeYen: 500, capacity: 10, belongings: "", notes: "", status: "published" });
    eventIds.push(id); return id;
  };
  const MAP = "https://maps.app.goo.gl/TestAbC123";

  test("登録: 不正な名前・URLは拒否(保存しない)。正しければ保存され、同じ会場名(表記ゆれ含む)は上書き。履歴が残る", T, async () => {
    const name = `zz_test_会場${rnd()}`;
    const before = (await V.listVenues()).length;
    for (const [n, u] of [["", MAP], [name, ""], [name, "javascript:alert(1)"], [name, "https://evil.example.com/maps"], [name, "http://maps.app.goo.gl/x"], ["あ".repeat(101), MAP]])
      assert.equal((await V.setVenue(n, u, "test")).ok, false, `${n}|${u}`);
    assert.equal((await V.listVenues()).length, before, "拒否したものは保存されない");
    assert.deepEqual(await V.setVenue(name, MAP, "test"), { ok: true });
    names.push(name);
    assert.equal((await V.listVenues()).length, before + 1);
    const spaced = name.replace("zz_test_", "zz_test_ ");
    assert.deepEqual(await V.setVenue(spaced, "https://www.google.com/maps/place/x", "test"), { ok: true });
    assert.equal((await V.listVenues()).length, before + 1, "空白の違いは同じ会場として上書き");
    const row = (await V.listVenues()).find((v) => venueKey(v.name) === venueKey(name));
    assert.equal(row.mapUrl, "https://www.google.com/maps/place/x");
    const hist = await db().collection("venues").doc(row.id).collection("history").get();
    assert.equal(hist.size, 2, "作成と更新の履歴");
  });

  test("リンク: 登録があればそのURL、なければ会場名の検索。削除すると検索に戻る。不正なIDの削除は何もしない", T, async () => {
    const reg = `zz_test_登録${rnd()}`, unreg = `zz_test_未登録${rnd()}`;
    await V.setVenue(reg, MAP, "test");
    const links = await V.venueLinks([reg, unreg, reg]);
    assert.equal(links[reg], MAP); assert.equal(links[unreg], searchUrl(unreg));
    const row = (await V.listVenues()).find((v) => v.name === reg);
    assert.equal(await V.deleteVenue("../x", "test"), false); assert.equal(await V.deleteVenue("0".repeat(24), "test"), false);
    assert.equal(await V.deleteVenue(row.id, "test"), true);
    assert.equal((await V.venueLinks([reg]))[reg], searchUrl(reg), "削除後は検索リンクに戻る");
  });

  test("リンク: 会場名が constructor・__proto__ などでも、読み出しでエラーにならない", T, async () => {
    const links = await V.venueLinks(["constructor", "__proto__", "toString"]);
    for (const n of ["constructor", "__proto__", "toString"]) assert.equal(links[n], searchUrl(n), n);
  });

  test("HTTP: イベント詳細・カレンダーで、会場名がGoogleマップのリンクになる(登録あり=登録のURL、なし=会場名の検索)。管理画面は未ログインで拒否", { timeout: 240_000 }, async () => {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/`, { redirect: "manual" }); if (r.status === 200) break; } catch {} await sleep(1000); }
    const reg = `zz_test_地図登録${rnd()}`, unreg = `zz_test_地図なし${rnd()}`;
    await V.setVenue(reg, MAP, "test");
    const e1 = await mkEvent(reg), e2 = await mkEvent(unreg);
    const page = async (path) => (await fetch(`${BASE}${path}`, { redirect: "manual" })).text();
    const d1 = await page(`/events/${e1}`), d2 = await page(`/events/${e2}`);
    assert.ok(d1.includes(`href="${MAP}"`) && d1.includes('rel="noopener noreferrer"') && d1.includes('target="_blank"'), "登録した会場は、登録のURLへ");
    assert.ok(d2.includes(`href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(unreg)}"`), "未登録は、会場名の検索へ");
    const home = await page("/");
    assert.ok(home.includes(`href="${MAP}"`) && home.includes(encodeURIComponent(unreg)), "カレンダーの、選んだ日の開催情報でも同じ");
    const admin = await fetch(`${BASE}/admin/venues`, { redirect: "manual" });
    assert.equal(admin.status, 307); assert.match(admin.headers.get("location"), /\/admin\/login/);
  });
}
