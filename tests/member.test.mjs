import test from "node:test";
import assert from "node:assert/strict";
import { nicknameProblem, nicknameKey, normalizeNickname, memberPasswordProblem, safeNext } from "../src/lib/domain/member.ts";

test("ニックネームの検証: 空・長すぎる・記号や制御文字は弾く。日本語・英数字・空白はOK", () => {
  assert.equal(nicknameProblem("たろう"), null); assert.equal(nicknameProblem("Taro_123"), null); assert.equal(nicknameProblem("山田 太郎"), null);
  assert.notEqual(nicknameProblem(""), null); assert.notEqual(nicknameProblem("   "), null);
  assert.notEqual(nicknameProblem("あ".repeat(21)), null); assert.equal(nicknameProblem("あ".repeat(20)), null);
  for (const bad of ["<b>", "a\u0000b", "a\u0007b", "x\"y", "it's", "a`b", "a\\b"]) assert.notEqual(nicknameProblem(bad), null, bad);
});
test("同じニックネームの判定: 大文字小文字・全角半角・余分な空白の違いは同じ扱い(重複登録・なりすまし防止)", () => {
  assert.equal(nicknameKey("Taro"), nicknameKey("taro")); assert.equal(nicknameKey("Ｔａｒｏ"), nicknameKey("taro"));
  assert.equal(nicknameKey("山田  太郎"), nicknameKey(" 山田 太郎 ")); assert.notEqual(nicknameKey("taro"), nicknameKey("taro2"));
  assert.equal(normalizeNickname("  ＡＢＣ  def "), "ABC def");
  assert.match(nicknameKey("x"), /^[a-f0-9]{64}$/);
});
test("パスワードの検証(参加者): 8文字以上・繰り返し・ニックネームと同じは弾く", () => {
  assert.notEqual(memberPasswordProblem("short"), null); assert.notEqual(memberPasswordProblem("aaaaaaaaaa"), null);
  assert.notEqual(memberPasswordProblem("tarotaro", "tarotaro"), null); assert.notEqual(memberPasswordProblem("TAROTARO", "tarotaro"), null);
  assert.equal(memberPasswordProblem("pass-1234"), null); assert.equal(memberPasswordProblem("ひらがなだけのぱすわーど"), null);
  assert.notEqual(memberPasswordProblem("x".repeat(101)), null);
});
test("ログイン後の戻り先は、同じサイト内の相対パスだけ(オープンリダイレクト防止)", () => {
  assert.equal(safeNext("/events/abc/apply"), "/events/abc/apply"); assert.equal(safeNext("/me?x=1"), "/me?x=1");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/../etc", "", null, undefined, 5]) assert.equal(safeNext(bad), "/", String(bad));
  assert.equal(safeNext("//evil", "/x"), "/x");
});

import { newTransferCode, normalizeTransferCode, transferCodeHash, transferCodeShape, TRANSFER_TTL_MS, TRANSFER_MAX_USES } from "../src/lib/domain/member.ts";
test("引き継ぎコード: 12文字・紛らわしい文字なし・毎回異なる・ハッシュで照合できる", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const { code, hash } = newTransferCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(transferCodeHash(code), hash); assert.equal(transferCodeHash(code.toLowerCase().replace(/-/g, " ")), hash);
    assert.ok(transferCodeShape(normalizeTransferCode(code))); assert.ok(!seen.has(code)); seen.add(code);
  }
});
test("引き継ぎコード: 形式が違う入力は弾く。期限は30分・1回", () => {
  for (const bad of ["", "ABC", "0000-0000-0000", "IIII-OOOO-1111", "A".repeat(13), "<script>"]) assert.ok(!transferCodeShape(normalizeTransferCode(bad)), bad);
  assert.equal(TRANSFER_TTL_MS, 30 * 60 * 1000); assert.equal(TRANSFER_MAX_USES, 1);
});

import { summarize, isJpeg } from "../src/lib/domain/mypage.ts";
test("マイページ集計: 累計・履歴は出席確認済みだけ。参加予定は開始前で取消・期限切れを除き、近い順に3件", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const mk = (id, startAt, status, attended = false) => ({ status, attended, event: { id, title: id, startAt } });
  const regs = [
    mk("p1", "2026-11-01T10:00:00Z", "confirmed", true), mk("p2", "2026-10-01T10:00:00Z", "confirmed", true), mk("p3", "2026-10-15T10:00:00Z", "confirmed", false),
    mk("p4", "2026-10-20T10:00:00Z", "cancelled", false),
    mk("f4", "2026-12-04T10:00:00Z", "confirmed"), mk("f1", "2026-11-11T10:00:00Z", "waitlisted"), mk("f2", "2026-11-20T10:00:00Z", "offered"), mk("f3", "2026-11-25T10:00:00Z", "confirmed"),
    mk("fx", "2026-11-12T10:00:00Z", "cancelled"), mk("fe", "2026-11-13T10:00:00Z", "expired"),
  ];
  const s = summarize(regs, now);
  assert.equal(s.attendedCount, 2); assert.deepEqual(s.history.map((r) => r.event.id), ["p1", "p2"]);
  assert.deepEqual(s.upcomingTop.map((r) => r.event.id), ["f1", "f2", "f3"]); assert.equal(s.upcoming.length, 4);
});
test("プロフィール画像: JPEG以外・空は弾く", () => {
  assert.ok(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))); assert.ok(!isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))); assert.ok(!isJpeg(new Uint8Array()));
});
