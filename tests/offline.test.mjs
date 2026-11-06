import test from "node:test";
import assert from "node:assert/strict";
import { classifyCheckIn, overlay, opCounts, isOpId } from "../src/lib/domain/offline.ts";
import { needsReconfirm, RECONFIRM_STATUSES } from "../src/lib/domain/registration.ts";

test("受付チェックの競合判定: 目的の値なら何もしない/記録時と同じなら適用/他端末で変更済みなら保留/forceで適用", () => {
  assert.equal(classifyCheckIn(true, false, true), "noop");
  assert.equal(classifyCheckIn(false, false, true), "apply");
  assert.equal(classifyCheckIn(true, false, false), "conflict"); // 記録時は未受付→他端末が受付済みにした後、自分は取消を記録
  assert.equal(classifyCheckIn(true, false, false, true), "apply");
});
test("未同期の操作は画面に重ねて見せ、pending を付ける。保留(held)は重ねない", () => {
  const regs = [{ id: "a", checkedIn: false, balance: 500 }, { id: "b", checkedIn: false, balance: 300 }];
  const ops = [
    { opId: "x".repeat(16), type: "checkin", regId: "a", value: true, expect: false, label: "a", state: "pending" },
    { opId: "y".repeat(16), type: "pay", regId: "a", amountYen: 500, label: "a", state: "pending" },
    { opId: "z".repeat(16), type: "pay", regId: "b", amountYen: 300, label: "b", state: "held" },
  ];
  const r = overlay(regs, ops);
  assert.deepEqual([r[0].checkedIn, r[0].balance, r[0].pending], [true, 0, true]);
  assert.deepEqual([r[1].checkedIn, r[1].balance, r[1].pending], [false, 300, false]);
  assert.deepEqual(opCounts(ops), { pending: 2, held: 1 });
});
test("操作IDの形式検証", () => {
  assert.equal(isOpId("a".repeat(16)), true); assert.equal(isOpId("short"), false); assert.equal(isOpId("../" + "a".repeat(20)), false); assert.equal(isOpId(5), false);
});
test("日程変更の再確認: 開始日時が変わるときだけ。対象は確定・待ち・繰上げ中", () => {
  assert.equal(needsReconfirm("2026-12-01T19:00:00+09:00", "2026-12-08T19:00:00+09:00"), true);
  assert.equal(needsReconfirm("2026-12-01T19:00:00+09:00", "2026-12-01T10:00:00Z"), false); // 同時刻(表記違い)
  assert.deepEqual([...RECONFIRM_STATUSES].sort(), ["confirmed", "offered", "waitlisted"]);
});
