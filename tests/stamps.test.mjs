import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CYCLE, DEFAULT_TIERS, decideTap, discountFor, isStampSport, nextPoints, parseTiers, tagToken, tapWindow, verifyTagToken, visitIndex,
} from "../src/lib/domain/stamps.ts";

test("ポイントは1ずつ進み、5の次は1に戻る(0に戻って貯め直し)", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(nextPoints), [1, 2, 3, 4, 5, 1]);
  assert.equal(CYCLE, 5);
});

test("今日の来場が何ポイント目か: かざす前は次のポイント、かざした後はいまのポイント", () => {
  assert.equal(visitIndex(2, false), 3);
  assert.equal(visitIndex(3, true), 3);
  assert.equal(visitIndex(5, false), 1);
  assert.equal(visitIndex(5, true), 5);
});

test("割引は3ポイント目と5ポイント目の回だけ。参加費を超えない", () => {
  const t = DEFAULT_TIERS.badminton;
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => discountFor(i, t, 500)), [0, 0, 100, 0, 200]);
  assert.equal(discountFor(5, t, 150), 150); // 参加費を超えない
  assert.equal(discountFor(3, t, 0), 0);
  assert.equal(discountFor(3, { 3: 100, 5: 200 }, -10), 0);
});

test("割引額の設定の検証: 整数・0以上・上限あり。足りない・不正なら null", () => {
  const ok = { badminton: { 3: 100, 5: 200 }, volleyball: { 3: 0, 5: 300 } };
  assert.deepEqual(parseTiers(ok), ok);
  assert.equal(parseTiers(null), null);
  assert.equal(parseTiers({ badminton: { 3: 100, 5: 200 } }), null);
  assert.equal(parseTiers({ ...ok, volleyball: { 3: -1, 5: 300 } }), null);
  assert.equal(parseTiers({ ...ok, volleyball: { 3: 1.5, 5: 300 } }), null);
  assert.equal(parseTiers({ ...ok, volleyball: { 3: "100", 5: 300 } }), null);
  assert.equal(parseTiers({ ...ok, volleyball: { 3: 100, 5: 1_000_000 } }), null);
});

test("対象の競技はバドミントンとバレーボールだけ", () => {
  assert.equal(isStampSport("badminton"), true);
  assert.equal(isStampSport("volleyball"), true);
  assert.equal(isStampSport("other"), false);
  assert.equal(isStampSport(undefined), false);
});

test("タグを読める時間: 開始3時間前〜終了から90日後(付け忘れの後づけ)", () => {
  const ev = { startAt: "2026-11-23T10:00:00+09:00", endAt: "2026-11-23T12:00:00+09:00" };
  const at = (s) => new Date(s).getTime();
  assert.equal(tapWindow(ev, at("2026-11-23T06:59:00+09:00")), "early");
  assert.equal(tapWindow(ev, at("2026-11-23T07:00:00+09:00")), "open");
  assert.equal(tapWindow(ev, at("2026-11-23T18:00:00+09:00")), "open");
  assert.equal(tapWindow(ev, at("2026-11-23T18:01:00+09:00")), "open");
  assert.equal(tapWindow(ev, at("2027-02-20T12:00:00+09:00")), "open");
  assert.equal(tapWindow(ev, at("2027-02-21T12:01:00+09:00")), "late");
  assert.equal(tapWindow({ startAt: "x", endAt: "y" }, 0), "late");
});

const base = { sportSupported: true, enabled: true, hasConfirmedRegistration: true, window: "open", alreadyTapped: false, points: 2 };
test("かざした結果の判定: 付与されるのは、すべての条件を満たしたときだけ", () => {
  assert.deepEqual(decideTap(base), { result: "ok", pointsAfter: 3 });
  assert.deepEqual(decideTap({ ...base, points: 5 }), { result: "ok", pointsAfter: 1 });
  assert.equal(decideTap({ ...base, sportSupported: false }).result, "unsupported");
  assert.equal(decideTap({ ...base, window: "early" }).result, "early");
  assert.equal(decideTap({ ...base, window: "late" }).result, "late");
  assert.equal(decideTap({ ...base, hasConfirmedRegistration: false }).result, "noreg");
  assert.equal(decideTap({ ...base, enabled: false }).result, "off");
  assert.equal(decideTap({ ...base, alreadyTapped: true }).result, "already");
  for (const r of [{ enabled: false }, { hasConfirmedRegistration: false }, { alreadyTapped: true }, { window: "late" }]) {
    assert.equal(decideTap({ ...base, ...r }).pointsAfter, 2, "付与されないときはポイントが変わらない");
  }
});

test("OFFの人はポイントが貯まらない(さかのぼりもしない)", () => {
  const off = decideTap({ ...base, enabled: false, points: 4 });
  assert.deepEqual(off, { result: "off", pointsAfter: 4 });
});

const SECRET = randomBytes(24).toString("hex"); // テスト用の秘密は、実行のたびに作る(固定の文字列を書かない)
const OTHER = randomBytes(24).toString("hex");
test("タグのURL: 正しいトークンだけ通る。版・競技・秘密が違うと落ちる(競技ごとに1枚)", () => {
  const tk = tagToken(SECRET, "badminton", 1);
  assert.match(tk, /^1\.[A-Za-z0-9_-]{32}$/);
  assert.equal(verifyTagToken(SECRET, "badminton", 1, tk), true);
  assert.equal(verifyTagToken(SECRET, "volleyball", 1, tk), false, "別の競技のタグは使えない");
  assert.equal(verifyTagToken(OTHER, "badminton", 1, tk), false);
  assert.equal(verifyTagToken(SECRET, "badminton", 2, tk), false, "再発行後は古いURLが使えない");
  assert.equal(verifyTagToken(SECRET, "badminton", 1, tk.slice(0, -1) + (tk.endsWith("A") ? "B" : "A")), false, "改ざん");
  assert.equal(verifyTagToken(SECRET, "badminton", 1, "1.short"), false);
  assert.equal(verifyTagToken(SECRET, "badminton", 1, ""), false);
  assert.equal(verifyTagToken("short", "badminton", 1, tagToken("short", "badminton", 1)), false, "短すぎる秘密では常に拒否");
});

test("タグは毎回同じ(同じ競技・同じ版なら、何度作っても同じURL)。再発行すると新しい版だけが使える", () => {
  assert.equal(tagToken(SECRET, "badminton", 1), tagToken(SECRET, "badminton", 1));
  const v1 = tagToken(SECRET, "badminton", 1), v2 = tagToken(SECRET, "badminton", 2);
  assert.notEqual(v1, v2);
  assert.equal(verifyTagToken(SECRET, "badminton", 2, v2), true);
  assert.equal(verifyTagToken(SECRET, "badminton", 2, v1), false);
  assert.notEqual(tagToken(SECRET, "badminton", 1), tagToken(SECRET, "volleyball", 1));
});

import { buildTicketModel, TAP_NOTICE } from "../src/lib/domain/stampticket.ts";
import { DEFAULT_LAP_REWARDS } from "../src/lib/domain/stampcard2.ts";
const T = { sport: "badminton", enabled: true, points: 2, lap: 1, rewards: DEFAULT_LAP_REWARDS, tapped: false, event: { startAt: "2026-11-23T10:00:00+09:00", venue: "播磨町総合体育館" }, feeYen: 500, partySize: 1 };
test("チケット: 参加費は割り引かない(特典はクーポン)。次の特典までの案内と、3pt・5ptの特典ラベル", () => {
  const m = buildTicketModel(T, "たろう");
  assert.deepEqual([m.phase, m.hasEvent, m.discountYen, m.priceYen, m.lap], ["today", true, 0, 500, 1]);
  assert.equal(m.nextText, "1周目 ― 3ポイントで100円引き(あと1ポイント)");
  assert.match(m.kicker, /本日の参加費/);
  assert.deepEqual(m.slots.map((s) => [s.on, s.tier, s.label]), [[true, false, "1pt"], [true, false, "2pt"], [false, true, "100円引"], [false, false, "通常"], [false, true, "200円引"]]);
  assert.equal(m.participant, "たろう");
});
test("チケット: 偶数周は特典が変わり(3pt=200円引き・5pt=無料)、色はゴールド。かざした後は次回の案内", () => {
  const even = buildTicketModel({ ...T, lap: 2, points: 4 }, "たろう");
  assert.equal(even.nextText, "2周目 ― 5ポイントで参加費1回無料(あと1ポイント)");
  assert.deepEqual(even.slots.map((s) => s.label), ["1pt", "2pt", "3pt", "4pt", "無料"]);
  assert.equal(even.accent, "#8a5d0b"); assert.notEqual(buildTicketModel(T, "たろう").accent, "#8a5d0b");
  const after = buildTicketModel({ ...T, points: 3, tapped: true, tapPoints: 3 }, "たろう", 3);
  assert.deepEqual([after.phase, after.slots[2].isNew], ["next", true]);
  assert.match(after.kicker, /次回の参加費/);
});
test("チケット: 参加予定なしのときは、開催情報・料金を出さない。同行者は「ほか○名」", () => {
  const none = buildTicketModel({ ...T, event: null, feeYen: 0 }, "たろう");
  assert.deepEqual([none.hasEvent, none.priceYen, none.discountYen, none.participant], [false, 0, 0, ""]);
  assert.equal(none.nextText, "1周目 ― 3ポイントで100円引き(あと1ポイント)", "参加予定がなくても、次の特典は出る");
  assert.equal(buildTicketModel({ ...T, partySize: 3 }, "たろう").participant, "たろう ほか2名");
});
test("かざした結果の案内文が、すべての結果に用意されている", () => {
  for (const k of ["off", "noreg", "already", "early", "late", "unsupported", "invalid", "bad", "retry", "busy"]) assert.ok(TAP_NOTICE[k], k);
});

test("チケット: 会場のリンクを持たせられる。参加予定なしのときは出さない", () => {
  const m = buildTicketModel(T, "たろう", 0, "https://maps.app.goo.gl/x");
  assert.equal(m.venueHref, "https://maps.app.goo.gl/x");
  assert.equal(buildTicketModel(T, "たろう").venueHref, null);
  assert.equal(buildTicketModel({ ...T, event: null, feeYen: 0 }, "たろう", 0, "https://maps.app.goo.gl/x").venueHref, null);
});
