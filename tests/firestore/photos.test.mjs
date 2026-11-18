// 公開の写真(カレンダーの参加者一覧用): 本人が選んだときだけ公開・公開キーは推測できず取り消せる・他人の写真は出ない・メンバー削除で消える。実Firestore+実Next.jsで確認する。
// テスト用のデータは zz_test_ で始め、終わりに削除する。
import test, { after } from "node:test";
import { jpegBytes } from "../helpers/jpeg.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.RUN_FIRESTORE_TESTS !== "1" || process.env.FIRESTORE_EMULATOR_HOST) {
  test("写真", { skip: "npm run test:firestore で実行" }, () => {});
} else {
  const { db } = await import("@/lib/firebase/admin");
  const Mem = await import("@/lib/repo/members");
  const R = await import("@/lib/repo/registrations");
  const A = await import("@/lib/repo/avatars");
  const Part = await import("@/lib/repo/participants");
  const { hashSecret } = await import("@/lib/domain/registration");

  const rnd = () => randomBytes(4).toString("hex");
  const PW = "テスト用パスワード-12345";
  const memberIds = [], eventIds = [], sessionHashes = [];
  // 写真の設定の回数制限(IPごと・10分)は、テストを繰り返しても当たらないよう、前後で、この種類の数え直しを消す。
  const resetLimits = async () => { for (const d of (await db().collection("ratelimits").where("scope", "==", "avatar").get()).docs) await d.ref.delete(); };
  await resetLimits();
  const PORT = 3243, BASE = `http://127.0.0.1:${PORT}`;
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  after(async () => {
    proc.kill("SIGTERM");
    await resetLimits();
    for (const id of memberIds) {
      const m = await db().collection("members").doc(id).get();
      if (m.exists) { await db().collection("nicknames").doc(m.data().nicknameKey).delete(); await m.ref.delete(); }
      await db().collection("memberAvatars").doc(id).delete().catch(() => {});
    }
    for (const h of sessionHashes) await db().collection("memberSessions").doc(h).delete().catch(() => {});
    for (const id of eventIds) await db().recursiveDelete(db().collection("events").doc(id));
    const dl = await db().collection("memberDeletions").get(); for (const d of dl.docs) if (String(d.data().nickname).startsWith("zz_test_")) await d.ref.delete();
  });
  const T = { timeout: 120_000 };
  const mkMember = async (t) => { const nickname = `zz_test_${t}${rnd()}`.slice(0, 20); const r = await Mem.createMember(nickname, PW, "self"); assert.ok(r.ok, JSON.stringify(r)); memberIds.push(r.id); return { id: r.id, nickname }; };
  const sessionFor = async (m) => { const h = await Mem.getMemberPasswordHash(m.id); const { token } = await Mem.createMemberSession(m.id, h); sessionHashes.push(hashSecret(token)); return `playce_member=${token}`; };
  const jpeg = () => jpegBytes(256, 256, 200 + Math.floor(Math.random() * 50)); // 構造が正しい小さな JPEG(中身はテスト用。毎回違う)
  const iso = (d) => d.toISOString().replace("Z", "+00:00");
  const mkEvent = async (minutes = 10) => {
    const id = `zz_test_${rnd()}`, start = new Date(Date.now() + minutes * 60e3);
    await db().collection("events").doc(id).set({ title: "【自動テスト】写真", sport: "badminton", venue: "テスト会場", startAt: iso(start), endAt: iso(new Date(start.getTime() + 2 * 3600e3)), feeYen: 500, capacity: 20, belongings: "", notes: "", status: "published" });
    eventIds.push(id); return id;
  };
  const apply = async (eid, m) => { const r = await R.createRegistration(eid, { nickname: m.nickname, members: [], confirmDuplicate: true }, `b-${rnd()}${rnd()}`, { id: m.id }); assert.ok(r.ok, JSON.stringify(r)); };
  const keyOf = async (m) => (await db().collection("members").doc(m.id).get()).data().photoKey ?? null;

  test("公開の切り替え: 画像がないと公開できない。公開するとキー(22文字・乱数)ができ、画像を取得できる。止めるとキーが消えて取得できない。再公開は新しいキー", T, async () => {
    const a = await mkMember("A"), img = jpeg();
    assert.equal(await A.setPhotoPublic(a.id, true), "no_avatar");
    assert.equal(await A.getPhotoPublic(a.id), false);
    assert.ok(await A.setAvatar(a.id, img));
    assert.equal(await A.getPhotoPublic(a.id), false, "画像を設定しただけでは公開されない");
    assert.equal(await A.getPublicPhoto("AbCdEfGhIjKlMnOpQrStUv"), null);
    assert.equal(await A.setPhotoPublic(a.id, true), "ok");
    const k1 = await keyOf(a);
    assert.match(k1, /^[A-Za-z0-9_-]{22}$/); assert.ok(!k1.includes(a.id), "キーにメンバーIDを含まない");
    assert.deepEqual(Buffer.from((await A.getPublicPhoto(k1)).data), Buffer.from(img));
    assert.equal(await A.setPhotoPublic(a.id, true), "ok"); assert.equal(await keyOf(a), k1, "公開中の再設定では、キーは変わらない");
    assert.equal(await A.setPhotoPublic(a.id, false), "ok");
    assert.equal(await keyOf(a), null); assert.equal(await A.getPublicPhoto(k1), null, "止めたあとは、同じキーでは取得できない");
    assert.equal(await A.setPhotoPublic(a.id, true), "ok");
    const k2 = await keyOf(a); assert.notEqual(k2, k1, "再公開は、新しいキー"); assert.equal(await A.getPublicPhoto(k1), null);
    assert.equal(await A.setPhotoPublic("zz_not_a_member", true), "invalid"); assert.equal(await A.setPhotoPublic("../x", true), "invalid");
    assert.equal(await A.getPublicPhoto("short"), null); assert.equal(await A.getPublicPhoto("../../etc/passwd"), null);
    await A.deleteAvatar(a.id);
    assert.equal(await keyOf(a), null, "画像を消すと、キーも消える"); assert.equal(await A.getPublicPhoto(k2), null); assert.equal(await A.getPhotoPublic(a.id), false);
  });

  test("参加者一覧: 公開を選んだ人の写真キーだけが、名前と同じ順で出る。選んでいない人・隠した人・画像だけの人は出ない。人数には全員を含める", T, async () => {
    const pub = await mkMember("P"), none = await mkMember("N"), priv = await mkMember("V"), hidden = await mkMember("H"), e = await mkEvent();
    for (const m of [pub, none, priv, hidden]) await apply(e, m);
    for (const m of [pub, priv, hidden]) assert.ok(await A.setAvatar(m.id, jpeg()));
    await A.setPhotoPublic(pub.id, true); await A.setPhotoPublic(hidden.id, true);
    const hreg = (await db().collection("events").doc(e).collection("registrations").where("memberId", "==", hidden.id).get()).docs[0];
    await hreg.ref.update({ publicHidden: true });
    const p = (await Part.listPublicParticipants([e]))[e];
    assert.deepEqual(p.names, [pub.nickname, none.nickname, priv.nickname]);
    assert.equal(p.photos.length, 3); assert.equal(p.photos[0], await keyOf(pub)); assert.equal(p.photos[1], null); assert.equal(p.photos[2], null);
    assert.equal(p.total, 4);
    assert.ok(!JSON.stringify(p).includes(pub.id) && !JSON.stringify(p).includes(hidden.id), "メンバーIDを出さない");
    assert.ok(!p.photos.includes(await keyOf(hidden)), "隠した人の写真は出ない");
  });

  test("保存: 公開の設定と同じトランザクション。非公開で差し替えると、古いキーはすぐ使えない。壊れた画像・大きすぎる画素数・メンバーがいない場合は保存しない", T, async () => {
    const a = await mkMember("S"), img1 = jpeg(), img2 = jpeg();
    assert.equal(await A.saveAvatar(a.id, img1, true), "ok");
    const k = await keyOf(a); assert.ok(k);
    assert.deepEqual(Buffer.from((await A.getPublicPhoto(k)).data), Buffer.from(img1));
    assert.equal(await A.saveAvatar(a.id, img2, true), "ok"); assert.equal(await keyOf(a), k, "公開のまま差し替えても、キーは変わらない");
    assert.deepEqual(Buffer.from((await A.getPublicPhoto(k)).data), Buffer.from(img2), "新しい画像が、同じキーで返る");
    assert.equal(await A.saveAvatar(a.id, jpeg(), false), "ok");
    assert.equal(await keyOf(a), null, "非公開で保存したら、キーはその場で消える");
    assert.equal(await A.getPublicPhoto(k), null, "古いキーでは、新しい(非公開の)画像は取れない");
    for (const bad of [new TextEncoder().encode("not an image"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(300)]), jpegBytes(5000, 5000), jpegBytes(8, 8), new Uint8Array(160 * 1024)])
      assert.equal(await A.saveAvatar(a.id, bad, true), "invalid");
    assert.equal(await keyOf(a), null, "拒否したときは、公開の設定も変わらない");
    assert.equal(await A.saveAvatar("zz_no_such_member", jpeg(), true), "no_member");
    assert.equal((await db().collection("memberAvatars").doc("zz_no_such_member").get()).exists, false, "メンバーがいなければ、画像を作らない");
  });

  test("メンバーを削除すると、画像と公開キーも消える", T, async () => {
    const a = await mkMember("D"); await A.setAvatar(a.id, jpeg()); await A.setPhotoPublic(a.id, true);
    const k = await keyOf(a);
    assert.ok(await A.getPublicPhoto(k));
    assert.equal(await Mem.deleteMemberRecord(a.id, "test", 0), "ok");
    assert.equal(await A.getPublicPhoto(k), null);
    assert.equal((await db().collection("memberAvatars").doc(a.id).get()).exists, false);
  });

  test("HTTP: 公開の写真は誰でも取得できるが、選んだ人の分だけ。止めると404。他人の画像は取得できない。カレンダーの参加者一覧に写真が出る", { timeout: 240_000 }, async () => {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/`, { redirect: "manual" }); if (r.status === 200) break; } catch {} await sleep(1000); }
    const a = await mkMember("HA"), b = await mkMember("HB"), ca = await sessionFor(a), cb = await sessionFor(b), img = jpeg(), e = await mkEvent(10);
    await apply(e, a); await apply(e, b);
    const same = { origin: BASE, host: `127.0.0.1:${PORT}`, "x-requested-with": "playce" };
    const put = (cookie, q, body) => fetch(`${BASE}/account/avatar${q}`, { method: "PUT", headers: { ...same, cookie, "content-type": "image/jpeg" }, body });
    const patch = (cookie, body, extra = same) => fetch(`${BASE}/account/avatar`, { method: "PATCH", headers: { ...extra, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    // 未ログイン・ヘッダなしは拒否
    assert.equal((await fetch(`${BASE}/account/avatar`, { method: "PUT", headers: { ...same, "content-type": "image/jpeg" }, body: img })).status, 401);
    assert.equal((await put(ca, "", img.slice(0, 2))).status, 400, "JPEGでないものは拒否");
    assert.equal((await patch(ca, { public: true }, { cookie: ca })).status, 403, "ヘッダなしは拒否");
    assert.equal((await patch(ca, { public: true })).status, 409, "画像がないと公開できない");
    // 設定(公開しない) → 公開キーはない
    let r = await put(ca, "", img); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, public: false });
    assert.equal(await keyOf(a), null);
    assert.equal((await patch(ca, { public: "yes" })).status, 400);
    // 公開 → 誰でも取得できる
    r = await patch(ca, { public: true }); assert.equal(r.status, 200);
    const key = await keyOf(a);
    const anon = await fetch(`${BASE}/photo/${key}`);
    assert.equal(anon.status, 200); assert.equal(anon.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await anon.arrayBuffer()), Buffer.from(img));
    assert.equal(anon.headers.get("x-content-type-options"), "nosniff"); assert.equal(anon.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(anon.headers.get("cache-control"), /public, max-age=60/); assert.match(anon.headers.get("x-robots-tag"), /noimageindex/);
    assert.equal(anon.headers.get("set-cookie"), null);
    // カレンダー・イベント詳細の参加者一覧に、Aの写真だけが出る
    const home = await (await fetch(`${BASE}/`)).text(), detail = await (await fetch(`${BASE}/events/${e}`)).text();
    assert.ok(home.includes(`/photo/${key}`), "カレンダーに出る"); assert.ok(detail.includes(`/photo/${key}`), "イベント詳細に出る");
    assert.equal((detail.match(/<img[^>]+src="\/photo\/[A-Za-z0-9_-]{22}"/g) ?? []).length, 1, "写真の <img> は1枚だけ(Bは公開していない)");
    assert.ok(!detail.includes(a.id) && !detail.includes(b.id), "メンバーIDを出さない");
    // 他人の画像は取得できない: B は自分の画像(なし)しか取れない。Aの画像のキーを、B が使っても何も変わらない
    assert.equal((await fetch(`${BASE}/account/avatar`, { headers: { cookie: cb } })).status, 404);
    assert.equal((await fetch(`${BASE}/account/avatar`)).status, 401);
    assert.equal((await patch(cb, { public: true })).status, 409, "Bの操作は、Bの画像だけが対象");
    assert.equal(await keyOf(a), key, "Bの操作で、Aの設定は変わらない");
    // 不正なキー
    for (const k of ["short", "AbCdEfGhIjKlMnOpQrStUv", "..%2F..%2Fx", "a".repeat(40)]) assert.equal((await fetch(`${BASE}/photo/${k}`)).status, 404, k);
    // 公開中の写真を、非公開で差し替える → 古いキーは、その場で404
    r = await put(ca, "?public=0", jpeg()); assert.deepEqual(await r.json(), { ok: true, public: false });
    assert.equal((await fetch(`${BASE}/photo/${key}`)).status, 404, "差し替えと同時に、古いキーは無効");
    assert.equal(await keyOf(a), null);
    r = await patch(ca, { public: true }); assert.equal(r.status, 200);
    const keyB = await keyOf(a); assert.notEqual(keyB, key);
    // 止める → 404・一覧から消える
    assert.equal((await patch(ca, { public: false })).status, 200);
    assert.equal((await fetch(`${BASE}/photo/${keyB}`)).status, 404, "止めたあとは404");
    assert.ok(!(await (await fetch(`${BASE}/`)).text()).includes(`/photo/${keyB}`));
    // 大きすぎる本文は、Content-Length がなくても(ストリーム)、上限を超えたところで拒否
    const big = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(100 * 1024)); c.enqueue(new Uint8Array(100 * 1024)); c.close(); } });
    r = await fetch(`${BASE}/account/avatar`, { method: "PUT", headers: { ...same, cookie: ca, "content-type": "image/jpeg" }, body: big, duplex: "half" });
    assert.equal(r.status, 413);
    assert.equal((await put(ca, "", jpegBytes(5000, 5000))).status, 400, "画素数が大きいものは拒否");
    assert.equal((await put(ca, "", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(300)]))).status, 400, "構造が壊れたものは拒否");
    // 公開で再設定 → 新しいキー。画像を削除 → 404
    r = await put(ca, "?public=1", img); assert.deepEqual(await r.json(), { ok: true, public: true });
    const key2 = await keyOf(a); assert.notEqual(key2, keyB); assert.equal((await fetch(`${BASE}/photo/${keyB}`)).status, 404);
    assert.equal((await fetch(`${BASE}/photo/${key2}`)).status, 200);
    assert.equal((await fetch(`${BASE}/account/avatar`, { method: "DELETE", headers: { ...same, cookie: ca } })).status, 200);
    assert.equal((await fetch(`${BASE}/photo/${key2}`)).status, 404, "画像を消すと、公開も止まる");
  });
}
