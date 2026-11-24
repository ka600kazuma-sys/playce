import test from "node:test";
import assert from "node:assert/strict";
import { qrToken, verifyQrToken, addPoints, isQrCount, tagToken } from "../src/lib/domain/stamps.ts";
import { stampPathFromQr } from "../src/lib/domain/stampqr.ts";

const S = "test-secret-0123456789";
test("付け忘れ用QRの署名: イベント+個数が合うときだけ通る", () => {
  const t1 = qrToken(S, "ev1", 1), t2 = qrToken(S, "ev1", 2);
  assert.equal(verifyQrToken(S, "ev1", 1, t1), true);
  assert.equal(verifyQrToken(S, "ev1", 2, t2), true);
  assert.equal(verifyQrToken(S, "ev1", 2, t1), false, "1個用のQRを2個として使えない");
  assert.equal(verifyQrToken(S, "ev2", 1, t1), false, "別のイベントでは使えない");
  assert.equal(verifyQrToken("other-secret-0123456789", "ev1", 1, t1), false);
  assert.equal(verifyQrToken(S, "ev1", 3, t1), false);
  assert.equal(verifyQrToken(S, "ev1", 1, t1.slice(1)), false);
  assert.equal(verifyQrToken(S, "ev1", 1, ""), false);
  assert.equal(isQrCount(1) && isQrCount(2) && !isQrCount(0) && !isQrCount(3) && !isQrCount("1"), true);
  assert.notEqual(t1, tagToken(S, "badminton", 1), "タグの署名とは別物");
});

test("ポイントを個数ぶん重ねる(5の次は1)", () => {
  assert.equal(addPoints(0, 1), 1); assert.equal(addPoints(0, 2), 2);
  assert.equal(addPoints(2, 2), 4); assert.equal(addPoints(4, 2), 1); assert.equal(addPoints(5, 1), 1); assert.equal(addPoints(5, 2), 2);
});

test("アプリ内カメラ: このサイトのスタンプのURLだけ開く", () => {
  const O = "https://playce.example", tok = "A".repeat(32);
  assert.equal(stampPathFromQr(`${O}/stamp/t/badminton/1.${tok}`, O), `/stamp/t/badminton/1.${tok}`);
  assert.equal(stampPathFromQr(`${O}/stamp/q/ev_1/2/${tok}`, O), `/stamp/q/ev_1/2/${tok}`);
  for (const bad of [`https://evil.example/stamp/q/ev_1/2/${tok}`, `${O}/stamp/q/ev_1/3/${tok}`, `${O}/stamp/q/ev_1/2/${tok}?x=1`, `${O}/stamp/q/ev_1/2/${tok}#a`,
    `${O}/admin`, `${O}/stamp/t/other/1.${tok}`, `https://user:pw@playce.example/stamp/q/ev_1/2/${tok}`, "javascript:alert(1)", "hello", "", `${O}/stamp/q/../admin/2/${tok}`]) assert.equal(stampPathFromQr(bad, O), null, bad);
});
