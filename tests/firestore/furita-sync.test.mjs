// ふりたへの事前取得: コードの発行・使用(期限・回数・イベント限定)・取得したトークンでの受付(QR検証)。実Firestore。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("ふりた事前取得", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const F = await import("@/lib/repo/furitasync");
  const Q = await import("@/lib/repo/receptionqr");
  const { transferCodeHash, normalizeTransferCode } = await import("@/lib/domain/member");
  const rnd = () => randomBytes(4).toString("hex");
  const memberIds = [], eventIds = [], codeHashes = [];
  after(async () => {
    for (const id of memberIds) { const m = await db().collection("members").doc(id).get(); if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); } }
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
    for (const h of codeHashes) await db().collection("tabletCodes").doc(h).delete().catch(() => {});
  });
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
  const NOW = Date.now(), H = 3600e3;
  const mkEvent = async (o = {}) => { const id = `zz_test_${rnd()}`; await db().collection("events").doc(id).set({ title: "【自動テスト】ふりた", sport: "badminton", venue: "テスト会場", startAt: iso(NOW - H), endAt: iso(NOW + 3 * H), feeYen: 500, capacity: 20, belongings: "", notes: "", status: "published", stampMultiplier: 3, ...o }); eventIds.push(id); return id; };
  const T = { timeout: 120_000 };

  test("コード発行→取得: 開催情報・倍率・トークン一覧が返り、そのトークンで受付できる(秘密鍵は返さない)", T, async () => {
    const e = await mkEvent();
    const { code } = await F.issueTabletCode(e, "test"); codeHashes.push(transferCodeHash(code));
    const r = await F.redeemTabletCode(code);
    assert.equal(r.event.id, e); assert.equal(r.event.multiplier, 3);
    assert.ok(r.tokens.length > 100 && r.tokens.length <= 1440, String(r.tokens.length));
    assert.ok(Math.abs(r.serverNow - Date.now()) < 5000);
    assert.equal(JSON.stringify(r).includes(process.env.FORM_SECRET ?? "dev-only-form-secret"), false, "秘密鍵は含まない");
    const slot = Math.floor(Date.now() / 30000), tok = r.tokens.find((t) => t.startsWith(`${slot}.`));
    assert.ok(tok, "現在のスロットのトークンがある");
    const m = (await (async () => { const n = `zz_test_F${rnd()}`.slice(0, 20); const x = await Mem.createMember(n, "テスト用パスワード-12345", "self"); memberIds.push(x.id); return x; })());
    assert.equal((await Q.scanReception(m.id, e, tok)).result, "walkin_ok");
  });

  test("無効なコード(形式違い・未発行・別形式)・期限切れ・回数超過・非公開イベントは、区別なく null", T, async () => {
    assert.equal(await F.redeemTabletCode("abc"), null);
    assert.equal(await F.redeemTabletCode("AAAA-BBBB-CCCC"), null);
    assert.equal(await F.redeemTabletCode("ABCD-EFGH-JKLM"), null);
    assert.equal(await F.redeemTabletCode(null), null);
    const e = await mkEvent(); const { code } = await F.issueTabletCode(e, "test"); const h = transferCodeHash(code); codeHashes.push(h);
    const ref = db().collection("tabletCodes").doc(h);
    await ref.update({ expiresAt: Date.now() - 1 }); assert.equal(await F.redeemTabletCode(code), null, "期限切れ");
    await ref.update({ expiresAt: Date.now() + 1e6, uses: 20 }); assert.equal(await F.redeemTabletCode(code), null, "回数超過");
    await ref.update({ uses: 0 }); assert.ok(await F.redeemTabletCode(code));
    await db().collection("events").doc(e).update({ status: "hidden" }); assert.equal(await F.redeemTabletCode(code), null, "非公開");
    assert.equal(await F.issueTabletCode("nonexistent_event", "t"), null);
    assert.equal(normalizeTransferCode("abcd-efgh"), "ABCDEFGH");
  });

  test("コードは、そのイベントのトークンしか取得できない(別イベントのトークンでは受付できない)", T, async () => {
    const a = await mkEvent(), b = await mkEvent();
    const { code } = await F.issueTabletCode(a, "t"); codeHashes.push(transferCodeHash(code));
    const r = await F.redeemTabletCode(code);
    const slot = Math.floor(Date.now() / 30000), tok = r.tokens.find((t) => t.startsWith(`${slot}.`));
    const n = `zz_test_G${rnd()}`.slice(0, 20); const x = await Mem.createMember(n, "テスト用パスワード-12345", "self"); memberIds.push(x.id);
    assert.equal((await Q.scanReception(x.id, b, tok)).result, "bad");
  });
}
