import test from "node:test";
import assert from "node:assert/strict";
import { toPublicParticipants } from "../src/lib/domain/participants.ts";

const r = (nickname, partySize, status, extra = {}) => ({ nickname, partySize, status, createdAt: 1, ...extra });

test("公開の参加者一覧: 参加確定の代表者だけ。待ち・繰上げ中・取消・期限切れは出さない", () => {
  const p = toPublicParticipants([r("甲", 1, "confirmed"), r("乙", 1, "waitlisted"), r("丙", 1, "offered"), r("丁", 1, "cancelled"), r("戊", 1, "expired")]);
  assert.deepEqual(p, { names: ["甲"], total: 1 });
});
test("同行者は名前を出さず人数にだけ含める。隠した人は名前を出さないが人数には含める", () => {
  const p = toPublicParticipants([r("甲", 3, "confirmed"), r("乙", 1, "confirmed", { publicHidden: true })]);
  assert.deepEqual(p, { names: ["甲"], total: 4 });
});
test("申込順に並ぶ/誰もいなければ空", () => {
  assert.deepEqual(toPublicParticipants([r("後", 1, "confirmed", { createdAt: 9 }), r("先", 1, "confirmed", { createdAt: 2 })]).names, ["先", "後"]);
  assert.deepEqual(toPublicParticipants([]), { names: [], total: 0 });
});
test("返すのは names と total だけ(トークン・ブラウザ識別・金額などのフィールドを持たない)", () => {
  const p = toPublicParticipants([{ ...r("甲", 1, "confirmed"), token: "secret", browserHash: "h", paidYen: 500 }]);
  assert.deepEqual(Object.keys(p).sort(), ["names", "total"]);
  assert.ok(!JSON.stringify(p).includes("secret") && !JSON.stringify(p).includes("500"));
});
