import test from "node:test";
import assert from "node:assert/strict";
import { parseAllowlist, isAllowedAdmin, isSameOrigin, sameOriginOf } from "../src/lib/auth/allowlist.ts";

const google = { email: "Owner@Example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
const list = parseAllowlist(" owner@example.com , ");

test("許可リスト内の確認済みGoogleアカウントは許可(大文字小文字を区別しない)", () => {
  assert.equal(isAllowedAdmin(google, list), true);
});
test("許可リスト外は拒否", () => {
  assert.equal(isAllowedAdmin({ ...google, email: "other@example.com" }, list), false);
});
test("許可リストが未設定・空なら全員拒否", () => {
  assert.equal(isAllowedAdmin(google, parseAllowlist(undefined)), false);
  assert.equal(isAllowedAdmin(google, parseAllowlist(" , ")), false);
});
test("メール未確認は拒否", () => {
  assert.equal(isAllowedAdmin({ ...google, email_verified: false }, list), false);
  assert.equal(isAllowedAdmin({ ...google, email_verified: undefined }, list), false);
});
test("Google以外のログイン方式は拒否", () => {
  assert.equal(isAllowedAdmin({ ...google, firebase: { sign_in_provider: "password" } }, list), false);
  assert.equal(isAllowedAdmin({ ...google, firebase: undefined }, list), false);
});
test("メールなしは拒否", () => {
  assert.equal(isAllowedAdmin({ email_verified: true, firebase: { sign_in_provider: "google.com" } }, list), false);
});
test("Origin が同一ホストのときだけ許可", () => {
  assert.equal(isSameOrigin("https://app.web.app", "app.web.app"), true);
  assert.equal(isSameOrigin("https://evil.example", "app.web.app"), false);
  assert.equal(isSameOrigin(null, "app.web.app"), false);
  assert.equal(isSameOrigin("not a url", "app.web.app"), false);
});
test("プロキシ配下: Host が内部名でも、X-Forwarded-Host(公開ドメイン)と一致すれば同一オリジン。別サイトは拒否", () => {
  assert.equal(isSameOrigin("https://app.hosted.app", "internal.run.app", "app.hosted.app"), true);
  assert.equal(isSameOrigin("https://app.hosted.app", "internal.run.app", "app.hosted.app, other"), true);
  assert.equal(isSameOrigin("https://evil.example", "internal.run.app", "app.hosted.app"), false);
  assert.equal(isSameOrigin("https://app.hosted.app", "internal.run.app", null), false);
  assert.equal(isSameOrigin(null, "app.hosted.app", "app.hosted.app"), false);
  const h = (o) => new Headers({ origin: o, host: "internal.run.app", "x-forwarded-host": "app.hosted.app" });
  assert.equal(sameOriginOf(h("https://app.hosted.app")), true); assert.equal(sameOriginOf(h("https://evil.example")), false);
});
