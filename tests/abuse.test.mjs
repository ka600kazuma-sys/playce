import test from "node:test";
import assert from "node:assert/strict";
import { signFormToken, verifyFormToken, clientIp, windowIndex } from "../src/lib/domain/abuse.ts";

const S = "test-secret-0123456789";
const t0 = 1_800_000_000_000;

test("署名済みトークン: 3秒未満は拒否、3秒以上2時間以内は許可、期限切れは拒否", () => {
  const tok = signFormToken(S, t0);
  assert.equal(verifyFormToken(S, tok, t0 + 1000), false);
  assert.equal(verifyFormToken(S, tok, t0 + 5000), true);
  assert.equal(verifyFormToken(S, tok, t0 + 3 * 3600 * 1000), false);
});
test("改ざん・別の秘密・形式不正のトークンは拒否", () => {
  const tok = signFormToken(S, t0);
  assert.equal(verifyFormToken("other-secret", tok, t0 + 5000), false);
  assert.equal(verifyFormToken(S, tok.replace(/.$/, "x"), t0 + 5000), false);
  assert.equal(verifyFormToken(S, `${t0 - 100000}.${tok.split(".")[1]}`, t0 + 5000), false);
  assert.equal(verifyFormToken(S, "", t0 + 5000), false);
  assert.equal(verifyFormToken(S, "abc", t0 + 5000), false);
});
test("クライアントIP: 偽装されうる先頭ではなく、信頼段数から数える", () => {
  assert.equal(clientIp("6.6.6.6, 203.0.113.9", 1), "203.0.113.9");
  assert.equal(clientIp("6.6.6.6, 203.0.113.9, 130.211.0.1", 2), "203.0.113.9");
  assert.equal(clientIp(null, 1), "unknown");
  assert.equal(clientIp("not-an-ip!", 1), "unknown");
  assert.equal(clientIp("1.1.1.1", 2), "unknown");
});
test("ウィンドウ番号は期間ごとに増える", () => {
  assert.equal(windowIndex(0, 600000), 0);
  assert.equal(windowIndex(599999, 600000), 0);
  assert.equal(windowIndex(600000, 600000), 1);
});
