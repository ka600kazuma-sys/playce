import test from "node:test";
import assert from "node:assert/strict";
import { monthGrid, holidaysOf, shiftYm, dateLabel, weekdayOf } from "../src/lib/domain/calendar.ts";
import { visibleMenu } from "../src/lib/menu.ts";

test("2026年11月: 1日は日曜、23日は月曜・勤労感謝の日、30日で終わる", () => {
  assert.equal(weekdayOf(2026, 11, 1), 0);
  assert.equal(dateLabel(2026, 11, 23), "11月23日(月・祝)");
  const g = monthGrid(2026, 11);
  assert.equal(g[0][0], 1); assert.equal(g.at(-1)[1], 30); assert.ok(g.every((w) => w.length === 7));
});
test("祝日: 国民の休日・振替休日・春分秋分", () => {
  const h = holidaysOf(2026);
  assert.equal(h["2026-11-03"], "文化の日"); assert.equal(h["2026-09-22"], "国民の休日");
  assert.equal(h["2026-09-21"], "敬老の日"); assert.equal(h["2026-09-23"], "秋分の日");
  assert.equal(h["2026-05-06"], "振替休日"); assert.equal(h["2026-03-20"], "春分の日"); assert.equal(h["2026-10-12"], "スポーツの日");
});
test("月送り(年またぎ)", () => {
  assert.deepEqual(shiftYm(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(shiftYm(2026, 1, -1), { y: 2025, m: 12 });
});
test("メニュー: 参加者に主催者項目は出ず、主催者には主催者メニューが出る。準備中の項目は ready=false", () => {
  const p = visibleMenu(false), a = visibleMenu(true);
  assert.ok(!p.some((i) => i.href?.startsWith("/admin") && i.href !== "/admin/login"));
  assert.ok(p.some((i) => i.href === "/admin/login")); assert.ok(!a.some((i) => i.href === "/admin/login")); assert.ok(a.some((i) => i.href === "/admin"));
  assert.equal(p.find((i) => i.href === "/soon/record")?.ready, false);
  assert.equal(p.find((i) => i.href === "/")?.ready, true);
});
