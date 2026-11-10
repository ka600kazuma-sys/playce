import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, passwordProblem, fingerprint } from "../src/lib/domain/password.ts";

test("パスワードの強さの確認: 短い・繰り返し・長すぎるものは弾く。長い文章はOK", () => {
  assert.notEqual(passwordProblem("short"), null);
  assert.notEqual(passwordProblem("aaaaaaaaaaaaaaaaaaaa"), null);
  assert.notEqual(passwordProblem("x".repeat(201)), null);
  assert.equal(passwordProblem("みどりの-ことり-はるのかぜ-2026"), null);
  assert.equal(passwordProblem("correct horse battery staple"), null);
});
test("ハッシュ: 同じパスワードでも毎回違う値(ソルト)。元のパスワードは含まれない。正しいときだけ一致", async () => {
  const pw = "テスト用の長いパスワード-9a8b7c";
  const h1 = await hashPassword(pw), h2 = await hashPassword(pw);
  assert.notEqual(h1, h2); assert.ok(!h1.includes("テスト") && !h1.includes("9a8b7c"));
  assert.ok(h1.startsWith("scrypt$"));
  assert.equal(await verifyPassword(pw, h1), true); assert.equal(await verifyPassword(pw, h2), true);
  assert.equal(await verifyPassword(pw + "x", h1), false); assert.equal(await verifyPassword("", h1), false);
  assert.equal(await verifyPassword(pw.toUpperCase(), h1), false);
});
test("全角・半角の違いは同じ入力として扱う(NFKC)", async () => {
  const h = await hashPassword("abcdefghij-KLMNOP-123456");
  assert.equal(await verifyPassword("ａｂｃｄｅｆｇｈｉｊ－ＫＬＭＮＯＰ－１２３４５６", h), true);
});
test("壊れた・不正な形式のハッシュは常に不一致(例外を投げない)", async () => {
  for (const bad of ["", "plain", "scrypt$1$1$1$a$b", "scrypt$16384$8$1$$", "scrypt$99999999$8$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA", "md5$a$b$c$d$e"])
    assert.equal(await verifyPassword("whatever-long-password", bad), false, bad);
});
test("版の識別子: ハッシュが変わると変わる(パスワード変更で、発行済みセッションを無効にするため)", async () => {
  const a = await hashPassword("first-password-1234567"), b = await hashPassword("first-password-1234567");
  assert.equal(fingerprint(a), fingerprint(a)); assert.notEqual(fingerprint(a), fingerprint(b)); assert.equal(fingerprint(a).length, 16);
});
