import test from "node:test";
import assert from "node:assert/strict";
import { addPoints, revokePoints, stateOf, totalOf, pointsToNextReward, parseMultiplier } from "../src/lib/domain/stampcard2.ts";
import { issueTokens, verifyToken, jstDeadline, selfRegistration, SLOT_MS } from "../src/lib/domain/receptionqr.ts";

const S = (lap, points) => ({ lap, points });
test("1周目で3pt→100円引き、5pt→200円引き、2周目へ", () => {
  const a = addPoints(S(1, 2), 1);
  assert.deepEqual(a.state, S(1, 3)); assert.deepEqual(a.issued.map((i) => i.reward), [{ kind: "discount", yen: 100 }]);
  const b = addPoints(S(1, 4), 1);
  assert.deepEqual(b.state, S(2, 0)); assert.deepEqual(b.issued.map((i) => i.reward), [{ kind: "discount", yen: 200 }]);
});
test("偶数周は3pt=200円引き、5pt=無料", () => {
  const r = addPoints(S(2, 0), 5);
  assert.deepEqual(r.issued.map((i) => [i.threshold, i.reward]), [[3, { kind: "discount", yen: 200 }], [5, { kind: "free" }]]);
  assert.deepEqual(r.state, S(3, 0));
});
test("繰り越し: 1周目4ptから2pt → 5pt特典を発行し2周目1pt", () => {
  const r = addPoints(S(1, 4), 2);
  assert.deepEqual(r.state, S(2, 1)); assert.equal(r.issued.length, 1); assert.equal(r.issued[0].threshold, 5);
});
test("複数の到達を漏れなく: 2周目2ptから4pt → 偶数周5pt無料と、3周目の3pt100円引きは含まない/含む", () => {
  const r = addPoints(S(2, 2), 4); // 3(2周),5(2周),→3周1,2
  assert.deepEqual(r.issued.map((i) => [i.lap, i.threshold]), [[2, 3], [2, 5]]);
  assert.deepEqual(r.state, S(3, 1));
  const big = addPoints(S(1, 0), 10);
  assert.equal(big.issued.length, 4); assert.deepEqual(big.state, S(3, 0));
});
test("total/state の往復と次の特典までの数", () => {
  for (let t = 0; t < 30; t++) assert.equal(totalOf(stateOf(t)), t);
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => pointsToNextReward(S(1, p))), [3, 2, 1, 2, 1]);
});
test("取り消し: 発行済みクーポンと矛盾する場合は affected に出す(自動取消しない)", () => {
  const iss = [{ lap: 1, threshold: 3, reward: { kind: "discount", yen: 100 }, used: true }, { lap: 1, threshold: 5, reward: { kind: "discount", yen: 200 }, used: false }];
  const r = revokePoints(S(2, 1), 3, iss); // total 6 → 3
  assert.deepEqual(r.state, S(1, 3)); assert.equal(r.affected.length, 1); assert.equal(r.affected[0].threshold, 5);
  const z = revokePoints(S(1, 1), 5, []); assert.deepEqual(z.state, S(1, 0)); assert.equal(z.floor, true);
});
test("倍率は1/2/3のみ、既定は1", () => { assert.deepEqual([undefined, 1, 2, 3, 4, "2", 0].map(parseMultiplier), [1, 1, 2, 3, 1, 1, 1]); });
test("不正な加算は拒否", () => { assert.throws(() => addPoints(S(1, 0), -1)); assert.throws(() => addPoints(S(1, 0), 1.5)); });

const secret = "x".repeat(32), ev = "evt1";
const t0 = Date.UTC(2026, 10, 24, 10, 0, 0), win = { fromMs: t0 - 3600e3, toMs: t0 + 4 * 3600e3 };
test("QR: 発行→現在のスロットは有効、60秒超は期限切れ、改ざん・別イベントは拒否", () => {
  const toks = issueTokens(secret, ev, t0, t0 + 3600e3);
  assert.equal(toks.length, 121);
  const cur = toks[0].token;
  assert.equal(verifyToken(secret, ev, cur, t0 + 5000, win), "ok");
  assert.equal(verifyToken(secret, ev, cur, t0 + 5 * SLOT_MS, win), "expired");
  assert.equal(verifyToken(secret, ev, cur, t0 - 5 * SLOT_MS, win), "early");
  assert.equal(verifyToken(secret, "evt2", cur, t0 + 5000, win), "bad");
  assert.equal(verifyToken(secret, ev, cur.slice(0, -1) + (cur.endsWith("A") ? "B" : "A"), t0 + 5000, win), "bad");
  assert.equal(verifyToken(secret, ev, "abc", t0, win), "bad");
  assert.equal(verifyToken("short", ev, cur, t0, win), "bad");
});
test("QR: 発行の期間外スロットのトークンは無効・過大な範囲は発行しない", () => {
  const far = issueTokens(secret, ev, t0 + 10 * 3600e3, t0 + 10 * 3600e3 + 60e3)[0].token;
  assert.equal(verifyToken(secret, ev, far, t0 + 10 * 3600e3, win), "bad");
  assert.deepEqual(issueTokens(secret, ev, t0, t0 + 30 * 3600e3), []);
});
test("当日参加の期限: 開催日23:59(JST)まで。終了後は承認必要。翌0:00以降は拒否", () => {
  const start = Date.parse("2026-11-24T19:00:00+09:00"), end = Date.parse("2026-11-24T21:00:00+09:00");
  assert.equal(jstDeadline(start), Date.parse("2026-11-25T00:00:00+09:00"));
  assert.equal(selfRegistration(Date.parse("2026-11-24T20:00:00+09:00"), start, end), "ok");
  assert.equal(selfRegistration(Date.parse("2026-11-24T23:59:59+09:00"), start, end), "needs_approval");
  assert.equal(selfRegistration(Date.parse("2026-11-25T00:00:00+09:00"), start, end), "closed");
  // 開始が日付またぎ前(JST早朝=UTC前日)でもJST基準
  const early = Date.parse("2026-11-24T07:00:00+09:00");
  assert.equal(jstDeadline(early), Date.parse("2026-11-25T00:00:00+09:00"));
});

import { cardStateOf, planAward, parseLapRewards, DEFAULT_LAP_REWARDS } from "../src/lib/domain/stampcard2.ts";
test("旧カード(lapなし)は累計として読む。5は次の周の0", () => {
  assert.deepEqual([0, 3, 4, 5].map((p) => cardStateOf({ points: p })), [S(1, 0), S(1, 3), S(1, 4), S(2, 0)]);
  assert.deepEqual(cardStateOf(undefined), S(1, 0)); assert.deepEqual(cardStateOf({ lap: 3, points: 2 }), S(3, 2));
  assert.deepEqual(cardStateOf({ points: 99 }), S(2, 0)); assert.deepEqual(cardStateOf({ points: -1 }), S(1, 0));
});
test("付与計画: 旧カード5ptに+1→2周目1pt、クーポンなし。倍率2で4pt→+2は5pt特典", () => {
  const a = planAward({ points: 5 }, 1, "k"); assert.deepEqual(a.after, S(2, 1)); assert.equal(a.coupons.length, 0);
  const b = planAward({ points: 4 }, 2, "ev1_m1"); assert.deepEqual(b.after, S(2, 1));
  assert.deepEqual(b.coupons.map((c) => c.id), ["ev1_m1_1_5"]);
  assert.equal(planAward({ lap: 2, points: 2 }, 1, "z").coupons[0].reward.kind, "discount"); // 偶数周3pt
});
test("特典設定の検証", () => {
  assert.deepEqual(parseLapRewards(DEFAULT_LAP_REWARDS), DEFAULT_LAP_REWARDS);
  assert.equal(parseLapRewards({ odd: {} }), null);
  assert.equal(parseLapRewards({ ...DEFAULT_LAP_REWARDS, even: { 3: { kind: "discount", yen: -1 }, 5: { kind: "free" } } }), null);
});

import { makePending, parsePending, PENDING_MAX_MS } from "../src/lib/domain/receptionqr.ts";
test("ログイン前の保留: 署名・期限つき。改ざん・期限切れ・未来の時刻・別の鍵は拒否", () => {
  const tok = `59850279.${"a".repeat(32)}`, ts = Date.UTC(2026, 10, 24, 10, 0, 0), v = makePending(secret, "ev1", tok, ts);
  assert.deepEqual(parsePending(secret, v, ts + 60e3), { eventId: "ev1", token: tok, ts });
  assert.equal(parsePending(secret, v, ts + PENDING_MAX_MS + 1), null, "15分超");
  assert.equal(parsePending(secret, v, ts - 60e3), null, "未来の時刻");
  assert.equal(parsePending("y".repeat(32), v, ts + 1000), null, "別の鍵");
  assert.equal(parsePending(secret, v.replace("ev1", "ev2"), ts + 1000), null, "イベントIDの改ざん");
  assert.equal(parsePending(secret, v.slice(0, -1) + "x", ts + 1000), null);
  assert.equal(parsePending(secret, "garbage", ts), null);
});
