import test from "node:test";
import assert from "node:assert/strict";
import { publicOrigin } from "../src/lib/domain/origin.ts";

const PUB = "playce--playce-e1455.asia-east1.hosted.app";
const RUN = "playce-cl75a5f26a-de.a.run.app";

test("公開用のアドレス: 設定があれば、それを使う", () => {
  assert.equal(publicOrigin({ configured: `https://${PUB}`, host: RUN }), `https://${PUB}`);
  assert.equal(publicOrigin({ configured: `https://${PUB}/ignored/path?x=1`, host: RUN }), `https://${PUB}`, "パスやクエリは落とす");
});
test("設定がなければ、x-forwarded-host(公開用)を、内部の host より優先する。本番の実際の形", () => {
  assert.equal(publicOrigin({ forwardedHost: PUB, host: RUN }), `https://${PUB}`);
  assert.equal(publicOrigin({ forwardedHost: `${PUB}, other.example.com`, host: RUN }), `https://${PUB}`, "複数あれば先頭");
});
test("内部アドレス(*.run.app)は、使わない。公開用が分からなければ null", () => {
  assert.equal(publicOrigin({ host: RUN }), null);
  assert.equal(publicOrigin({ forwardedHost: RUN, host: RUN }), null);
  assert.equal(publicOrigin({ configured: `https://${RUN}`, host: RUN }), null, "設定が内部アドレスでも使わない");
  assert.equal(publicOrigin({ forwardedHost: "playce-336328653773.asia-east1.run.app" }), null);
  assert.equal(publicOrigin({}), null);
});
test("host しかなくても、公開用なら使う。開発では http(localhost)", () => {
  assert.equal(publicOrigin({ host: PUB }), `https://${PUB}`);
  assert.equal(publicOrigin({ host: "127.0.0.1:3000" }), "http://127.0.0.1:3000");
  assert.equal(publicOrigin({ forwardedHost: "localhost:3000" }), "http://localhost:3000");
});
test("不正な値は使わない: 記号・空白・認証情報つき・http の公開ドメイン・壊れた設定", () => {
  for (const bad of ["evil.com/x", "evil.com?a=b", "a b.com", "user@evil.com", "ev<il>.com", "-bad.com", "bad-.com", "", "  "]) assert.equal(publicOrigin({ forwardedHost: bad }), null, bad);
  assert.equal(publicOrigin({ configured: "http://evil.example.com", host: PUB }), `https://${PUB}`, "設定が http の公開ドメインなら、設定は使わず、ヘッダーに進む");
  assert.equal(publicOrigin({ configured: "https://user:pw@evil.example.com", host: PUB }), `https://${PUB}`);
  assert.equal(publicOrigin({ configured: "not a url", host: PUB }), `https://${PUB}`);
  assert.equal(publicOrigin({ configured: "javascript:alert(1)", host: PUB }), `https://${PUB}`);
});

test("本番(allowHeaders=false)は、設定だけを使う。設定が未設定・不正なら null(ヘッダーに頼らない・外部ドメインを採用しない)", () => {
  assert.equal(publicOrigin({ configured: `https://${PUB}`, forwardedHost: "evil.example.com", host: RUN, allowHeaders: false }), `https://${PUB}`);
  assert.equal(publicOrigin({ forwardedHost: "evil.example.com", host: RUN, allowHeaders: false }), null);
  assert.equal(publicOrigin({ forwardedHost: PUB, allowHeaders: false }), null, "本番では、正しい転送ヘッダーでも使わない");
  assert.equal(publicOrigin({ configured: "not a url", forwardedHost: PUB, allowHeaders: false }), null);
  assert.equal(publicOrigin({ configured: `https://${RUN}`, forwardedHost: PUB, allowHeaders: false }), null);
  assert.equal(publicOrigin({ forwardedHost: PUB, allowHeaders: true }), `https://${PUB}`, "開発では、ヘッダーを使う");
});
test("範囲外のポート番号は使わない(65536以上)。範囲内は使える", () => {
  assert.equal(publicOrigin({ forwardedHost: "example.com:65536" }), null);
  assert.equal(publicOrigin({ forwardedHost: "example.com:99999" }), null);
  assert.equal(publicOrigin({ host: "localhost:65536" }), null);
  assert.equal(publicOrigin({ configured: "https://example.com:70000" }), null);
  assert.equal(publicOrigin({ host: "localhost:3000" }), "http://localhost:3000");
  assert.equal(publicOrigin({ forwardedHost: "example.com:8443" }), "https://example.com:8443");
});
