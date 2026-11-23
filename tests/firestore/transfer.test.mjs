// ニックネームのみの登録・自動ログイン用セッション・引き継ぎコード。実Firestoreで確認する(テスト用データは終了時に削除)。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("引き継ぎ", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const { hashSecret, newToken } = await import("@/lib/domain/registration");
  const { transferCodeHash } = await import("@/lib/domain/member");
  const ids = [];
  const nick = (t = "") => `zz_test_${t}${randomBytes(3).toString("hex")}`.slice(0, 20);
  after(async () => {
    for (const id of ids) {
      const m = await db().collection("members").doc(id).get();
      if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); }
      for (const c of (await db().collection("transferCodes").where("memberId", "==", id).get()).docs) await c.ref.delete();
      for (const c of (await db().collection("memberSessions").where("memberId", "==", id).get()).docs) await c.ref.delete();
      for (const c of (await db().collection("memberTransfers").where("memberId", "==", id).get()).docs) await c.ref.delete();
    }
  });
  const mk = async (t) => { const n = nick(t); const r = await Mem.createMemberNickOnly(n); assert.ok(r.ok, JSON.stringify(r)); ids.push(r.id); return { id: r.id, nickname: n }; };

  test("パスワード設定: ニックネームだけの端末(アプリ)は有効なまま、Safariではニックネーム+パスワードで入れる。変更には現在のパスワードが必要", async () => {
    const m = await mk("p");
    const app = (await Mem.createMemberSession(m.id)).token; // ホーム画面のアプリ(パスワードなし)
    assert.equal(await Mem.authenticateMember(m.nickname, "setting-pass-1234"), null); // 設定前は入れない
    const r = await Mem.setMemberPassword(m.id, "setting-pass-1234");
    assert.ok(r.ok && r.passwordHash);
    assert.deepEqual(await Mem.getMemberBySession(app), { id: m.id, nickname: m.nickname }); // アプリは追い出されない
    const who = await Mem.authenticateMember(m.nickname, "setting-pass-1234");
    assert.equal(who?.id, m.id);
    const safari = (await Mem.createMemberSession(who.id, who.passwordHash)).token;
    assert.ok(await Mem.getMemberBySession(safari));
    assert.equal(await Mem.authenticateMember(m.nickname, "wrong-pass-0000"), null);
    assert.equal((await Mem.changeMemberPassword(m.id, "wrong-pass-0000", "another-pass-5678")).ok, false); // 現在のパスワードが違う
    const c = await Mem.changeMemberPassword(m.id, "setting-pass-1234", "another-pass-5678");
    assert.ok(c.ok);
    assert.equal(await Mem.getMemberBySession(safari), null); // 変更前にパスワードで入った端末は無効
    assert.ok(await Mem.getMemberBySession(app)); // アプリはそのまま
    assert.equal((await Mem.setMemberPassword(m.id, "short")).ok, false); // 短すぎる
    assert.equal(await Mem.sessionHasPwv(app), false);
    assert.equal(await Mem.sessionHasPwv(safari), false); // 変更で無効になった
    const m2 = await mk("q"); // 同時の初回設定は、どちらか1つだけ成功
    const rs = await Promise.all([Mem.setMemberPassword(m2.id, "first-pass-1111", null), Mem.setMemberPassword(m2.id, "second-pass-2222", null)]);
    assert.equal(rs.filter((x) => x.ok).length, 1);
  });

  test("初回登録(ニックネーム+パスワード): 弱いパスワードは拒否。登録後はSafariでパスワードでログインでき、アプリのセッションは版に縛られない", async () => {
    const n = nick("s");
    assert.equal((await Mem.createMember(n, "short", "self")).ok, false);
    assert.equal((await Mem.createMember(n, n, "self")).ok, false); // ニックネームと同じ
    const r = await Mem.createMember(n, "signup-pass-1234", "self");
    assert.ok(r.ok); ids.push(r.id);
    const app = (await Mem.createMemberSession(r.id)).token;
    const who = await Mem.authenticateMember(n, "signup-pass-1234");
    assert.equal(who?.id, r.id);
    assert.equal(await Mem.authenticateMember(n, "wrong-pass-0000"), null);
    assert.equal((await Mem.createMember(n.toUpperCase(), "signup-pass-1234", "self")).ok, false); // 重複
    assert.ok((await Mem.setMemberPassword(r.id, "changed-pass-5678")).ok);
    assert.ok(await Mem.getMemberBySession(app)); // 変更してもアプリは追い出されない
  });

  test("初回登録はニックネームだけ。同じニックネーム(大文字小文字・全角半角違い)は、同時に登録しても1件だけ", async () => {
    const n = nick("a");
    const rs = await Promise.all([Mem.createMemberNickOnly(n), Mem.createMemberNickOnly(n.toUpperCase()), Mem.createMemberNickOnly(n)]);
    for (const r of rs) if (r.ok) ids.push(r.id);
    assert.equal(rs.filter((r) => r.ok).length, 1);
    assert.ok(rs.filter((r) => !r.ok).every((r) => r.code === "taken"));
  });

  test("自動ログイン: セッションで本人を読み込める。期限切れ・存在しないトークンは拒否。パスワードなしアカウントはパスワードでログイン不可", async () => {
    const m = await mk("b");
    const { token } = await Mem.createMemberSession(m.id);
    assert.deepEqual(await Mem.getMemberBySession(token), { id: m.id, nickname: m.nickname });
    assert.equal(await Mem.getMemberBySession(newToken().token), null);
    assert.equal(await Mem.authenticateMember(m.nickname, "何かのパスワード1234"), null);
    await db().collection("memberSessions").doc(hashSecret(token)).update({ expiresAt: Date.now() - 1 });
    assert.equal(await Mem.getMemberBySession(token), null);
  });

  test("引き継ぎ: 発行→新端末で復元(1回だけ)。旧端末のログインは解除。ニックネーム・IDは同じ", async () => {
    const m = await mk("c");
    const old = await Mem.createMemberSession(m.id);
    const issued = await Mem.issueTransferCode(m.id);
    const stored = await db().collection("transferCodes").doc(transferCodeHash(issued.code)).get();
    assert.ok(stored.exists); assert.ok(!JSON.stringify(stored.data()).includes(issued.code.replace(/-/g, "")), "コード自体は保存しない");
    const r = await Mem.redeemTransferCode(issued.code.toLowerCase());
    assert.ok(r.ok); assert.equal(r.memberId, m.id);
    assert.deepEqual(await Mem.getMemberBySession(r.token), { id: m.id, nickname: m.nickname });
    assert.equal(await Mem.getMemberBySession(old.token), null, "旧端末は解除");
    assert.equal((await Mem.redeemTransferCode(issued.code)).ok, false, "2回目は使えない");
  });

  test("引き継ぎ: 同時に2端末で使っても成功は1回だけ。期限切れ・不正・再発行前のコードは使えない", async () => {
    const m = await mk("d");
    const issued = await Mem.issueTransferCode(m.id);
    const rs = await Promise.all([Mem.redeemTransferCode(issued.code), Mem.redeemTransferCode(issued.code), Mem.redeemTransferCode(issued.code)]);
    assert.equal(rs.filter((r) => r.ok).length, 1);
    const i2 = await Mem.issueTransferCode(m.id);
    await db().collection("transferCodes").doc(transferCodeHash(i2.code)).update({ expiresAt: Date.now() - 1 });
    assert.equal((await Mem.redeemTransferCode(i2.code)).ok, false, "期限切れ");
    const i3 = await Mem.issueTransferCode(m.id), i4 = await Mem.issueTransferCode(m.id);
    assert.equal((await Mem.redeemTransferCode(i3.code)).ok, false, "再発行で前のコードは無効");
    assert.equal((await Mem.redeemTransferCode("AAAA-BBBB-CCCC")).ok, false);
    assert.equal((await Mem.redeemTransferCode("' or 1=1")).ok, false);
    assert.ok((await Mem.redeemTransferCode(i4.code)).ok);
  });

  test("引き継ぎ: 他人のIDだけでは取得できない(コードなしでは復元できない)・削除済みメンバーのコードは無効", async () => {
    const m = await mk("e");
    assert.equal((await Mem.redeemTransferCode(m.id)).ok, false);
    const issued = await Mem.issueTransferCode(m.id);
    const mm = await db().collection("members").doc(m.id).get(); await db().collection("nicknames").doc(mm.data().nicknameKey).delete(); await mm.ref.delete();
    assert.equal((await Mem.redeemTransferCode(issued.code)).ok, false);
  });
}
