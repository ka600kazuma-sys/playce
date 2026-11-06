// メッセージの隔離テスト(実Firestore+実際にNext.jsを起動してHTTPで確認)。
// 「送った本人(専用URL/そのブラウザのCookie)以外には、本文もニックネームも見えない」ことを、複数の経路で確認する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("メッセージ隔離テスト", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const M = await import("@/lib/repo/messages");
  const { hashSecret } = await import("@/lib/domain/registration");

  const PORT = 3231, BASE = `http://127.0.0.1:${PORT}`;
  const rnd = () => randomBytes(5).toString("hex");
  const S = { a: `秘密A${rnd()}`, b: `秘密B${rnd()}`, x: `秘密X${rnd()}` };
  const N = { a: `zz_test_甲${rnd()}`, b: `zz_test_乙${rnd()}`, x: `zz_test_丙${rnd()}` };
  const EV = { a: `イベントA${rnd()}`, b: `イベントB${rnd()}` };
  const XSS = `<img src=x onerror=alert(1)>${S.x}<script>alert(2)</script>`;
  const ids = [];
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  after(async () => { proc.kill("SIGTERM"); for (const id of ids) await db().recursiveDelete(db().collection("messages").doc(id)); });

  const get = (path, cookie) => fetch(BASE + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const html = async (path, cookie) => { const r = await get(path, cookie); return { status: r.status, headers: r.headers, text: await r.text() }; };
  const leaks = (text) => Object.entries({ ...S, ...N }).filter(([, v]) => text.includes(v)).map(([k]) => k);

  const A = await M.createThread({ nickname: N.a, body: S.a }, EV.a);
  const B = await M.createThread({ nickname: N.b, body: S.b }, EV.b);
  const X = await M.createThread({ nickname: N.x, body: XSS }, null);
  ids.push(hashSecret(A.token), hashSecret(B.token), hashSecret(X.token));
  await M.addOrganizerPost(hashSecret(A.token), `主催者から甲への返信${S.a}`);
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/contact"); break; } catch { await sleep(500); } }

  test("専用URLを知っている本人だけが、自分のスレッドを読める(他人の本文・ニックネームは含まれない)", { timeout: 120_000 }, async () => {
    const a = await html(`/contact/t/${A.token}`);
    assert.equal(a.status, 200); assert.ok(a.text.includes(S.a) && a.text.includes(N.a) && a.text.includes("主催者から甲への返信"));
    assert.deepEqual(leaks(a.text).filter((k) => !["a"].includes(k) && k !== "a"), [], "A のページに他人の情報が混ざっている");
    assert.ok(!a.text.includes(S.b) && !a.text.includes(N.b) && !a.text.includes(S.x) && !a.text.includes(N.x));
    const b = await html(`/contact/t/${B.token}`);
    assert.equal(b.status, 200); assert.ok(b.text.includes(S.b) && b.text.includes(N.b));
    assert.ok(!b.text.includes(S.a) && !b.text.includes(N.a) && !b.text.includes("主催者から甲への返信"));
  });

  test("URL(トークン)を少しでも変えると開けない/他の形のIDでも開けない", { timeout: 120_000 }, async () => {
    const t = A.token, flip = (s) => s.slice(0, -1) + (s.at(-1) === "A" ? "B" : "A");
    const bads = [flip(t), t.slice(0, -1), t + "A", t.toLowerCase() === t ? t.toUpperCase() : t.toLowerCase(), hashSecret(t), hashSecret(t).slice(0, 43), "A".repeat(43), ""];
    for (const x of bads) { const r = await get(`/contact/t/${x}`); assert.ok([404, 307, 308].includes(r.status), `${x.slice(0, 8)}… -> ${r.status}`); if (r.status === 404) assert.ok(!(await r.text()).includes(S.a)); }
  });

  test("一覧(/contact)は、そのブラウザのCookieにあるスレッドだけを出す。Cookieがなければ何も出さない。偽のCookieでも出ない", { timeout: 120_000 }, async () => {
    assert.deepEqual(leaks((await html("/contact")).text), []);
    assert.ok(!(await html("/contact")).text.includes(EV.a) && !(await html("/contact")).text.includes(EV.b));
    const ca = await html("/contact", `msg_${hashSecret(A.token).slice(0, 16)}=${A.token}`);
    assert.ok(ca.text.includes(EV.a)); assert.ok(!ca.text.includes(EV.b)); assert.deepEqual(leaks(ca.text), []); // 一覧には本文・ニックネームを出さない
    const cb = await html("/contact", `msg_${hashSecret(B.token).slice(0, 16)}=${B.token}`);
    assert.ok(cb.text.includes(EV.b) && !cb.text.includes(EV.a));
    for (const c of [`msg_x=${randomBytes(32).toString("base64url")}`, `msg_y=${hashSecret(A.token)}`, `msg_z=${hashSecret(A.token).slice(0, 43)}`, `msg_w=${A.token.slice(0, -1)}A`]) {
      const r = await html("/contact", c); assert.ok(!r.text.includes(EV.a) && !r.text.includes(EV.b), c.slice(0, 12));
    }
  });

  test("公開ページ・他の画面・管理画面の入口からは、メッセージの内容が一切見えない", { timeout: 180_000 }, async () => {
    for (const p of ["/", "/me", "/soon/record", "/events/x", "/contact"]) assert.deepEqual(leaks((await html(p)).text), [], p);
    const cookie = `msg_${hashSecret(A.token).slice(0, 16)}=${A.token}; playce_admin=forged`;
    for (const p of ["/admin", "/admin/messages", `/admin/messages/${hashSecret(A.token)}`, `/admin/messages/${hashSecret(B.token)}`]) {
      const r = await get(p, cookie); assert.ok([307, 308].includes(r.status), `${p} -> ${r.status}`);
      assert.match(r.headers.get("location") ?? "", /\/admin\/login/); assert.deepEqual(leaks(await r.text()), [], p);
    }
  });

  test("キャッシュ・検索・リファラへの漏れ対策のヘッダ(スレッドは保存させず、検索に出さず、リンク元を送らない)", { timeout: 120_000 }, async () => {
    const t = await html(`/contact/t/${A.token}`);
    assert.match(t.headers.get("cache-control") ?? "", /no-store/); assert.equal(t.headers.get("referrer-policy"), "no-referrer"); assert.match(t.headers.get("x-robots-tag") ?? "", /noindex/);
    for (const p of ["/contact", "/me"]) { const r = await get(p); assert.match(r.headers.get("cache-control") ?? "", /private|no-store/, p); assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/, p); }
  });

  test("本文は文字として表示される(HTMLやスクリプトとして実行されない)", { timeout: 120_000 }, async () => {
    const x = await html(`/contact/t/${X.token}`);
    assert.equal(x.status, 200); assert.ok(x.text.includes(S.x));
    assert.ok(!x.text.includes("<script>alert(2)</script>")); assert.ok(!x.text.includes("<img src=x onerror")); assert.ok(x.text.includes("&lt;script&gt;") || x.text.includes("&lt;img"));
  });

  test("自分のトークンでは自分のスレッドにしか投稿できない(他人のスレッドは増えない)", { timeout: 120_000 }, async () => {
    const before = (await M.getThreadByToken(B.token)).posts.length;
    assert.equal(await M.addParticipantPost(A.token, "Aからの追加"), "ok");
    assert.equal(await M.addParticipantPost(A.token.slice(0, -1) + "A", "不正"), A.token.endsWith("A") ? "ok" : "not_found");
    assert.equal((await M.getThreadByToken(B.token)).posts.length, before);
    assert.ok(!(await M.getThreadByToken(B.token)).posts.some((p) => p.body.includes("Aからの追加")));
  });
}
