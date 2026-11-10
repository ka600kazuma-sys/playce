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
