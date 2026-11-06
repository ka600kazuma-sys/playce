import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/lib/domain/accounting.ts";

test("売上・経費・利益を集計し、取消済みは含めない", () => {
  const s = summarize(
    [{ amountYen: 1000, voided: false }, { amountYen: 500, voided: true }, { amountYen: 2000, voided: false }],
    [{ amountYen: 1200, category: "会場費", voided: false }, { amountYen: 300, category: "消耗品", voided: false }, { amountYen: 999, category: "会場費", voided: true }],
  );
  assert.deepEqual(s, { revenue: 3000, expenses: 1500, profit: 1500, byCategory: { 会場費: 1200, 消耗品: 300 } });
});
test("赤字は負の利益になる", () => {
  assert.equal(summarize([], [{ amountYen: 800, category: "会場費", voided: false }]).profit, -800);
});
test("データなしは0", () => {
  assert.deepEqual(summarize([], []), { revenue: 0, expenses: 0, profit: 0, byCategory: {} });
});
