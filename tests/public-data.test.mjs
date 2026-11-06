// A4 公開イベントのデータに、参加者氏名・会計・管理URL・トークンが含まれないことの保証(型/読み取り範囲の静的確認)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventSchema } from "../src/lib/domain/events.ts";

const valid = { title: "バド", sport: "badminton", venue: "体育館", startAt: "2026-12-01T19:00:00+09:00", endAt: "2026-12-01T21:00:00+09:00", feeYen: 500, capacity: null, status: "published" };

test("A4 イベントの検証は未知のフィールド(参加者・会計・トークン等)を取り除く", () => {
  const p = eventSchema.parse({ ...valid, registrations: [{ nickname: "A" }], paidYen: 100, token: "secret", accounting: { sales: 1 }, managerUrl: "x" });
  for (const k of ["registrations", "paidYen", "token", "accounting", "managerUrl"]) assert.ok(!(k in p), k);
});
test("A4 公開イベントの読み取りは events コレクションの公開フィールドだけで、申込・入金・会計を参照しない", () => {
  const src = readFileSync(new URL("../src/lib/repo/events.ts", import.meta.url), "utf8");
  assert.ok(!/registrations|payments|accounting|expenses|audit/.test(src));
  assert.match(src, /eventSchema\.safeParse/);
});
test("Firestore / Storage ルールはクライアントからの直接アクセスを全面拒否(allow read, write: if false のみ)", () => {
  for (const f of ["../firestore.rules", "../storage.rules"]) {
    const r = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.match(r, /allow read, write: if false;/);
    assert.ok(!/if\s+true|request\.auth/.test(r), f);
  }
});
