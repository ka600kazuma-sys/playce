import test from "node:test";
import assert from "node:assert/strict";
import { newThreadSchema, postBodySchema, nextStatusAfterPost, THREAD_STATUS_LABEL, MAX_BODY } from "../src/lib/domain/messages.ts";

test("メッセージ入力の検証: ニックネーム・本文は必須、長さ上限、イベントIDは安全な文字だけ", () => {
  assert.equal(newThreadSchema.safeParse({ nickname: "太郎", body: "質問です" }).success, true);
  assert.equal(newThreadSchema.safeParse({ nickname: "", body: "x" }).success, false);
  assert.equal(newThreadSchema.safeParse({ nickname: "a", body: "   " }).success, false);
  assert.equal(newThreadSchema.safeParse({ nickname: "a".repeat(31), body: "x" }).success, false);
  assert.equal(newThreadSchema.safeParse({ nickname: "a", body: "x".repeat(MAX_BODY + 1) }).success, false);
  assert.equal(newThreadSchema.safeParse({ nickname: "a", body: "x".repeat(MAX_BODY) }).success, true);
  assert.equal(newThreadSchema.safeParse({ nickname: "a", body: "x", eventId: "../etc" }).success, false);
  assert.equal(newThreadSchema.safeParse({ nickname: "a", body: "x", eventId: "abc_123-X" }).success, true);
  assert.equal(postBodySchema.safeParse({ body: "" }).success, false);
  assert.equal(newThreadSchema.parse({ nickname: "  太郎  ", body: " こんにちは " }).nickname, "太郎"); // 前後の空白は除く
});
test("状態の遷移: 参加者の投稿で完了は未対応に戻る/主催者の返信で未対応は対応中になる/それ以外は変えない", () => {
  assert.equal(nextStatusAfterPost("participant", "done"), "open");
  assert.equal(nextStatusAfterPost("participant", "inprogress"), "inprogress");
  assert.equal(nextStatusAfterPost("participant", "open"), "open");
  assert.equal(nextStatusAfterPost("organizer", "open"), "inprogress");
  assert.equal(nextStatusAfterPost("organizer", "done"), "done");
  assert.equal(nextStatusAfterPost("organizer", "inprogress"), "inprogress");
});
test("状態の表示名", () => {
  assert.deepEqual(Object.values(THREAD_STATUS_LABEL), ["未対応", "対応中", "対応完了"]);
});
