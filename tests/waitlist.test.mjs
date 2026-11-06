import test from "node:test";
import assert from "node:assert/strict";
import { waitlistDeadline } from "../src/lib/domain/waitlist.ts";

const H = 3600 * 1000;
const now = new Date("2026-12-01T00:00:00Z");
const at = (h) => new Date(now.getTime() + h * H);

test("開催まで24時間超: 期限は24時間後", () => {
  assert.equal(waitlistDeadline(now, at(72)).getTime(), at(24).getTime());
});
test("開催24時間以内: 最大6時間", () => {
  assert.equal(waitlistDeadline(now, at(20)).getTime(), at(6).getTime());
});
test("開催6時間以内: 最大1時間", () => {
  assert.equal(waitlistDeadline(now, at(5)).getTime(), at(1).getTime());
});
test("開始時刻を超えない", () => {
  assert.equal(waitlistDeadline(now, new Date(now.getTime() + 30 * 60 * 1000)).getTime(), now.getTime() + 30 * 60 * 1000);
});
test("開始後は即時に期限切れ", () => {
  assert.equal(waitlistDeadline(now, at(-1)).getTime(), now.getTime());
});
