import test from "node:test";
import assert from "node:assert/strict";
import { eventSchema } from "../src/lib/domain/events.ts";
import { fromLocalInput, toLocalInput } from "../src/lib/format.ts";

const base = { title: "夜バド", sport: "badminton", venue: "体育館", startAt: "2026-12-05T19:00:00+09:00", endAt: "2026-12-05T21:00:00+09:00", feeYen: 500, capacity: null, status: "draft" };

test("日本時間の入力値とISOを相互変換できる", () => {
  assert.equal(fromLocalInput("2026-12-05T19:00"), "2026-12-05T19:00:00+09:00");
  assert.equal(toLocalInput("2026-12-05T19:00:00+09:00"), "2026-12-05T19:00");
  assert.equal(toLocalInput("2026-12-05T10:00:00Z"), "2026-12-05T19:00");
  assert.equal(fromLocalInput("bad"), "");
});
test("正しいイベントを受け付ける", () => {
  assert.equal(eventSchema.safeParse(base).success, true);
});
test("終了が開始以前なら拒否", () => {
  assert.equal(eventSchema.safeParse({ ...base, endAt: base.startAt }).success, false);
});
test("不正な日時・負の料金・不正な状態・定員0を拒否", () => {
  assert.equal(eventSchema.safeParse({ ...base, startAt: "" }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, feeYen: -1 }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, status: "x" }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, capacity: 0 }).success, false);
});
