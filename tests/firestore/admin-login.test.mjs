// 主催者のパスワードログイン(A2: 許可されていない人は入れない / A6: ログアウト・期限切れ・パスワード変更後は使えない)。
// 実Firestore+実際にNext.jsを起動してHTTPで確認する。テスト用のパスワード(ハッシュ)をその場で作る。本番のパスワードは使わない。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("主催者ログイン", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const { hashPassword } = await import("@/lib/domain/password");
  const { hashSecret } = await import("@/lib/domain/registration");

  const PORT = 3235, BASE = `http://127.0.0.1:${PORT}`;
  const rnd = () => randomBytes(4).toString("hex");
  const PW = `テスト用の長いログインパスワード-${rnd()}${rnd()}`;
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ADMIN_PASSWORD_HASH: await hashPassword(PW), ADMIN_EMAILS: "owner-test@example.com" } });
  const sessions = [];
  after(async () => { proc.kill("SIGTERM"); for (const h of sessions) await db().collection("adminSessions").doc(h).delete().catch(() => {}); });

  let n = 10;
  const ip = () => `203.0.113.${++n}`; // テストごとに別のIPとして扱う(回数制限の混線を避ける)
  const login = (password, address = ip(), headers = {}) => fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": address, ...headers }, body: JSON.stringify({ password }) });
  const cookieOf = (r) => /playce_admin=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  const get = (path, cookie) => fetch(BASE + path, { redirect: "manual", headers: cookie ? { cookie: `playce_admin=${cookie}` } : {} });
  const toLogin = async (path, cookie) => { const r = await get(path, cookie); return [307, 308].includes(r.status) && /\/admin\/login/.test(r.headers.get("location") ?? ""); };
  const newSession = async () => { const r = await login(PW); assert.equal(r.status, 200); const c = cookieOf(r); assert.ok(c); sessions.push(hashSecret(c)); return c; };
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/admin/login"); break; } catch { await sleep(500); } }

  test("A2 正しいパスワードだけがログインできる。間違い・空・長すぎる入力・別オリジンはセッションを発行しない", { timeout: 180_000 }, async () => {
    for (const bad of [PW + "x", PW.slice(0, -1), PW.toUpperCase(), "wrong-password-123456", "   "]) { const r = await login(bad); assert.equal(r.status, 401, bad.slice(0, 8)); assert.equal(r.headers.get("set-cookie"), null); }
    assert.equal((await login("")).status, 400); assert.equal((await login("x".repeat(401))).status, 400);
    assert.equal((await login(PW, ip(), { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PW }) })).status, 403); // Originなし
    const ok = await login(PW); assert.equal(ok.status, 200);
    const sc = ok.headers.get("set-cookie"); assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=strict/i); assert.match(sc, /Max-Age=28800/);
    const c = cookieOf(ok); sessions.push(hashSecret(c));
    assert.ok(!(await ok.text()).includes(PW));
    const doc = (await db().collection("adminSessions").doc(hashSecret(c)).get()).data();      // DBにはトークンもパスワードも保存されない
    assert.ok(!JSON.stringify(doc).includes(c) && !JSON.stringify(doc).includes(PW));
    assert.equal((await fetch(`${BASE}/api/auth/session`, { method: "POST", headers: { origin: BASE } })).status, 410);   // 旧Googleログインは廃止
  });

  test("ログイン後は管理画面が開き、偽・改変・別形式のCookieでは開かない", { timeout: 180_000 }, async () => {
    const c = await newSession();
    for (const p of ["/admin", "/admin/events", "/admin/messages"]) assert.equal((await get(p, c)).status, 200, p);
    const flip = c.slice(0, -1) + (c.endsWith("A") ? "B" : "A");
    for (const bad of [flip, c.slice(0, -1), c + "A", hashSecret(c), "A".repeat(43), randomBytes(32).toString("base64url"), "forged"]) assert.ok(await toLogin("/admin", bad), bad.slice(0, 8));
    assert.equal((await get("/admin/events/x/export", flip)).status, 403);
  });

  test("A6 ログアウトすると、同じCookieはもう使えない(サーバー側のセッションも消える)", { timeout: 180_000 }, async () => {
    const c = await newSession();
    assert.equal((await get("/admin", c)).status, 200);
    const out = await fetch(`${BASE}/api/auth/session`, { method: "DELETE", headers: { origin: BASE, cookie: `playce_admin=${c}` } });
    assert.equal(out.status, 200); assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await db().collection("adminSessions").doc(hashSecret(c)).get()).exists, false);
    assert.ok(await toLogin("/admin", c)); assert.ok(await toLogin("/admin/messages", c)); assert.equal((await get("/admin/events/x/export", c)).status, 403);
    assert.equal((await fetch(`${BASE}/api/auth/session`, { method: "DELETE", headers: { cookie: `playce_admin=${c}` } })).status, 403); // Originなしのログアウトは拒否
  });

  test("A6 有効期限が切れたセッション・パスワード変更後(版が違う)のセッションは使えない", { timeout: 180_000 }, async () => {
    const e = await newSession();
    await db().collection("adminSessions").doc(hashSecret(e)).update({ expiresAt: Date.now() - 1000 });
    assert.ok(await toLogin("/admin", e)); assert.equal((await get("/admin/events/x/export", e)).status, 403);
    const v = await newSession();
    await db().collection("adminSessions").doc(hashSecret(v)).update({ pwv: "oldpasswordver00" });   // パスワードを変えた(ハッシュの版が変わった)状態
    assert.ok(await toLogin("/admin", v));
  });

  test("総当たり対策: 同じIPから短時間に試行を重ねると、正しいパスワードでも一時的に拒否される(別のIPは影響を受けない)", { timeout: 180_000 }, async () => {
    const a = "198.51.100.77";
    for (let i = 0; i < 5; i++) await login("wrong-password-" + i + "-xxxxxxxx", a);
    const blocked = await login(PW, a); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("set-cookie"), null);
    const other = await login(PW); assert.equal(other.status, 200); sessions.push(hashSecret(cookieOf(other)));
  });
}
