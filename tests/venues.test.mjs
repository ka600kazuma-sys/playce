import test from "node:test";
import assert from "node:assert/strict";
import { mapUrlProblem, searchUrl, venueHref, venueKey, venueNameProblem } from "../src/lib/domain/venues.ts";

test("会場名のキー: 全角半角・大文字小文字・空白の違いを無視する", () => {
  assert.equal(venueKey("播磨町 総合体育館"), venueKey("播磨町総合体育館"));
  assert.equal(venueKey("ＡＢＣ アリーナ"), venueKey("abcアリーナ"));
  assert.notEqual(venueKey("姫路スーパーアリーナ"), venueKey("ひめじスーパーアリーナ"));
});

test("会場名の検索リンク: 会場名をURLエンコードしたGoogleマップの検索になる", () => {
  const u = new URL(searchUrl("播磨町総合体育館"));
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/search/");
  assert.equal(u.searchParams.get("api"), "1");
  assert.equal(u.searchParams.get("query"), "播磨町総合体育館");
  // 記号や &・# を含んでも、クエリが壊れない
  assert.equal(new URL(searchUrl("A&B #1/アリーナ")).searchParams.get("query"), "A&B #1/アリーナ");
});

test("地図URLの検証: https のGoogleマップだけ。他のサイト・http・javascript・認証情報つきは拒否", () => {
  for (const ok of [
    "https://maps.app.goo.gl/AbCdEf123", "https://www.google.com/maps/place/%E5%A7%AB%E8%B7%AF/@34.8,134.7,17z", "https://www.google.com/maps?q=34.8,134.7",
    "https://google.com/maps/@34.8,134.7,15z", "https://maps.google.com/?q=himeji", "https://goo.gl/maps/xyz", "https://www.google.co.jp/maps/place/x",
  ]) assert.equal(mapUrlProblem(ok), null, ok);
  for (const bad of [
    "", "  ", "javascript:alert(1)", "data:text/html,x", "http://maps.app.goo.gl/x", "https://evil.example.com/maps", "https://www.google.com/search?q=x",
    "https://www.google.com.evil.com/maps", "https://maps.app.goo.gl.evil.com/x", "https://user:pw@www.google.com/maps", "ftp://www.google.com/maps", "not a url",
    "https://www.google.com/mapsevil", "https://goo.gl/other", "https://goo.gl/mapsevil", "https://www.google.com/maps/" + "a".repeat(500),
  ]) assert.notEqual(mapUrlProblem(bad), null, bad);
});

test("会場名の検証: 空・長すぎるものは拒否", () => {
  assert.equal(venueNameProblem("播磨町総合体育館"), null);
  assert.notEqual(venueNameProblem("  "), null);
  assert.notEqual(venueNameProblem("あ".repeat(101)), null);
});

test("リンクの決まり方: 登録があればそのURL、なければ会場名の検索。壊れた登録は使わない", () => {
  const reg = { [venueKey("播磨町総合体育館")]: "https://maps.app.goo.gl/AbCdEf123", [venueKey("大和工業アリーナ")]: "javascript:alert(1)" };
  assert.deepEqual(venueHref("播磨町 総合体育館", reg), { href: "https://maps.app.goo.gl/AbCdEf123", registered: true });
  const search = venueHref("姫路スーパーアリーナ", reg);
  assert.equal(search.registered, false); assert.equal(search.href, searchUrl("姫路スーパーアリーナ"));
  assert.equal(venueHref("大和工業アリーナ", reg).registered, false, "不正なURLの登録は無視して検索リンクにする");
});

test("リンク: 会場名が constructor・__proto__・toString などでも、エラーにならず検索リンクになる", () => {
  for (const n of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    const r = venueHref(n, {});
    assert.equal(r.registered, false, n); assert.equal(r.href, searchUrl(n), n);
  }
  assert.equal(venueHref("x", { [venueKey("x")]: 123 }).registered, false, "文字列でない登録値は使わない");
});
