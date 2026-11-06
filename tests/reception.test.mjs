import test from "node:test";
import assert from "node:assert/strict";
import { amountDue, balance, totals, matches, csvCell } from "../src/lib/domain/reception.ts";

test("予定額は人数×申込時の料金、残額は入金実績との差", () => {
  assert.equal(amountDue({ partySize: 3, feeYen: 500 }), 1500);
  assert.equal(balance({ partySize: 3, feeYen: 500, paidYen: 500 }), 1000);
});
test("予定額と入金実績を分けて集計する(取消済み・待ちは予定額に含めない)", () => {
  const t = totals([
    { partySize: 2, feeYen: 500, paidYen: 1000, counts: true },
    { partySize: 1, feeYen: 500, paidYen: 0, counts: true },
    { partySize: 4, feeYen: 500, paidYen: 0, counts: false },
  ]);
  assert.deepEqual(t, { expected: 1500, received: 1000, outstanding: 500 });
});
test("部分一致検索: 代表者・同行者、全角半角・大文字小文字を区別しない", () => {
  assert.equal(matches("たろ", ["たろう", "はなこ"]), true);
  assert.equal(matches("ＨＡＮＡ", ["hana"]), true);
  assert.equal(matches("はな", ["たろう", "はなこ"]), true);
  assert.equal(matches("じろう", ["たろう"]), false);
  assert.equal(matches("  ", ["たろう"]), true);
});
test("CSV: 式インジェクションを無効化し、クォートする", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell(500), "500");
});
