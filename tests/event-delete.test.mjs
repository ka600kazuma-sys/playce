import test from "node:test";
import assert from "node:assert/strict";
import { deletionBlock, STATUS_ORDER, EVENT_STATUS } from "../src/lib/domain/events.ts";

test("削除の安全制限: 入金・経費・会計確定の記録があれば削除できない。申込だけなら削除できる", () => {
  const ok = { payments: 0, expenses: 0, accountingClosed: false };
  assert.equal(deletionBlock(ok), null);
  assert.match(deletionBlock({ ...ok, payments: 1 }) ?? "", /削除できません/);
  assert.match(deletionBlock({ ...ok, expenses: 2 }) ?? "", /非表示/);
  assert.notEqual(deletionBlock({ ...ok, accountingClosed: true }), null);
});
test("公開状態の並び: 「公開中」が一番上で、全ての状態を含む", () => {
  assert.equal(STATUS_ORDER[0], "published");
  assert.deepEqual([...STATUS_ORDER].sort(), [...EVENT_STATUS].sort());
});
