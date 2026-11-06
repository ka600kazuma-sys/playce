// 権限テスト(HTTP): 実際に Next.js を起動し、フロントを経由せずに管理画面・管理APIを直接呼んで拒否されることを確認する。
// Firestore には接続しない(認証前に拒否されるため)。実ログイン・実データが必要なケースは authz-isolation.test.mjs の todo に残す。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3217, BASE = `http://127.0.0.1:${PORT}`;
let proc;
const get = (p, headers = {}) => fetch(BASE + p, { redirect: "manual", headers });
const post = (p, body, headers = {}) => fetch(BASE + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const same = { origin: BASE, host: `127.0.0.1:${PORT}` };

before(async () => {
  proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/admin/login"); return; } catch { await sleep(500); } }
  throw new Error("Next.js が起動しませんでした");
}, { timeout: 90_000 });
after(() => { proc?.kill("SIGTERM"); });

const ADMIN_PAGES = ["/admin", "/admin/events", "/admin/events/new", "/admin/events/abc", "/admin/events/abc/reception", "/admin/events/abc/accounting", "/admin/events/abc/print"];

test("A1/A5 未ログイン・偽Cookieでは、管理画面をどのURLでもログイン画面へ戻す(フロント経由なしで直接アクセス)", { timeout: 120_000 }, async () => {
  for (const p of ADMIN_PAGES) {
    for (const headers of [{}, { cookie: "playce_admin=forged.token.value" }]) {
      const r = await get(p, headers);
      assert.ok([307, 308].includes(r.status), `${p} -> ${r.status}`);
      assert.match(r.headers.get("location") ?? "", /\/admin\/login/, p);
      const t = await r.text(); assert.ok(!/ログアウト|当日受付|イベントを編集|会計（売上/.test(t), `${p} は管理画面の中身を返さない`);
    }
  }
});

test("A1/A5/E1 CSV出力は、未ログイン・偽Cookieでは 403(参加者データを返さない)", { timeout: 60_000 }, async () => {
  for (const headers of [{}, { cookie: "playce_admin=forged.token.value" }]) {
    const r = await get("/admin/events/abc/export", headers);
    assert.equal(r.status, 403);
    const t = await r.text(); assert.ok(!t.includes("代表者") && !t.includes("registrations"));
  }
});

test("A5 オフライン受付の同期API: ヘッダなし/別オリジンは403、同一オリジンでも未ログインは401", { timeout: 60_000 }, async () => {
  const body = { eventId: "e1", regId: "r1", opId: "a".repeat(20), type: "checkin", value: true, expect: false };
  assert.equal((await post("/api/reception", body)).status, 403);
  assert.equal((await post("/api/reception", body, { ...same, "x-requested-with": "playce", origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/reception", body, { ...same, "x-requested-with": "playce" })).status, 401);
  assert.equal((await post("/api/reception", body, { ...same, "x-requested-with": "playce", cookie: "playce_admin=forged" })).status, 401);
});

test("A2/A5 セッション発行API: Originなし・別オリジンは403、不正なIDトークンはセッションを発行しない", { timeout: 60_000 }, async () => {
  assert.equal((await post("/api/auth/session", { idToken: "x".repeat(40) })).status, 403);
  assert.equal((await post("/api/auth/session", { idToken: "x".repeat(40) }, { ...same, origin: "https://evil.example" })).status, 403);
  const r = await post("/api/auth/session", { idToken: "x".repeat(40) }, same);
  assert.ok([401, 429].includes(r.status), `status ${r.status}`);
  assert.equal(r.headers.get("set-cookie"), null);
});

test("公開画面は未ログインで見られ、管理者向けの項目(主催者メニュー・参加者名簿)を含まない", { timeout: 60_000 }, async () => {
  const r = await get("/"); assert.equal(r.status, 200);
  const t = await r.text(); assert.ok(t.includes("主催者ログイン")); assert.ok(!t.includes("主催者メニュー")); assert.ok(!t.includes("当日受付"));
});
