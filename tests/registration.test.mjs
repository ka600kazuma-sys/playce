import test from "node:test";
import assert from "node:assert/strict";
import { rebalance, decideInitialStatus, newToken, hashSecret, isTokenShape, registrationInputSchema } from "../src/lib/domain/registration.ts";

const H = 3600 * 1000;
const now = new Date("2026-12-01T00:00:00Z");
const start = new Date(now.getTime() + 72 * H);
const row = (id, status, partySize, createdAt, offerExpiresAt = null) => ({ id, status, partySize, createdAt, offerExpiresAt });

test("定員なしは常に確定", () => {
  assert.equal(decideInitialStatus(null, [row("a", "confirmed", 50, 1)], 5), "confirmed");
});
test("定員内は確定、超えるとキャンセル待ち", () => {
  const rows = [row("a", "confirmed", 8, 1)];
  assert.equal(decideInitialStatus(10, rows, 2), "confirmed");
  assert.equal(decideInitialStatus(10, rows, 3), "waitlisted");
});
test("待ちがいる間は、空きがあっても新規はキャンセル待ち(順番を守る)", () => {
  const rows = [row("a", "confirmed", 5, 1), row("w", "waitlisted", 8, 2)];
  assert.equal(decideInitialStatus(10, rows, 1), "waitlisted");
});
test("取消で空くと先頭が繰上げられ、期限が付く", () => {
  const rows = [row("a", "cancelled", 2, 1), row("b", "confirmed", 8, 2), row("w1", "waitlisted", 2, 3), row("w2", "waitlisted", 1, 4)];
  const p = rebalance(10, rows, start, now);
  assert.equal(p.get("w1").status, "offered");
  assert.equal(p.get("w1").offerExpiresAt, now.getTime() + 24 * H);
  assert.equal(p.has("w2"), false);
});
test("先頭が枠に入らないとき、後続を飛ばさない", () => {
  const rows = [row("b", "confirmed", 9, 1), row("w1", "waitlisted", 3, 2), row("w2", "waitlisted", 1, 3)];
  assert.equal(rebalance(10, rows, start, now).size, 0);
});
test("期限切れの提示は失効し、次の人に繰り上がる", () => {
  const rows = [row("o", "offered", 2, 1, now.getTime() - 1), row("b", "confirmed", 8, 2), row("w", "waitlisted", 2, 3)];
  const p = rebalance(10, rows, start, now);
  assert.equal(p.get("o").status, "expired");
  assert.equal(p.get("w").status, "offered");
});
test("提示中は枠を確保したまま(重複して繰り上げない)", () => {
  const rows = [row("o", "offered", 2, 1, now.getTime() + H), row("b", "confirmed", 8, 2), row("w", "waitlisted", 1, 3)];
  assert.equal(rebalance(10, rows, start, now).size, 0);
});
test("トークンは推測困難で、保存用ハッシュと対応する", () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a.token, b.token);
  assert.ok(isTokenShape(a.token));
  assert.equal(hashSecret(a.token), a.hash);
  assert.ok(!isTokenShape("../etc/passwd"));
});
test("入力検証: 同意なし・空のニックネーム・人数超過を拒否", () => {
  const ok = { nickname: " たろう ", members: [], agreedRules: true };
  assert.equal(registrationInputSchema.parse(ok).nickname, "たろう");
  assert.equal(registrationInputSchema.safeParse({ ...ok, agreedRules: false }).success, false);
  assert.equal(registrationInputSchema.safeParse({ ...ok, nickname: "  " }).success, false);
  assert.equal(registrationInputSchema.safeParse({ ...ok, members: Array(10).fill("a") }).success, false);
});
