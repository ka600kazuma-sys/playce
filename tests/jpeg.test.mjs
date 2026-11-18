import test from "node:test";
import assert from "node:assert/strict";
import { jpegBytes } from "./helpers/jpeg.mjs";
import { AVATAR_MAX_DIM, jpegSize, validAvatarJpeg } from "../src/lib/domain/mypage.ts";

test("JPEGの大きさ: 構造を読んで、縦横を取り出す", () => {
  assert.deepEqual(jpegSize(jpegBytes(256, 192)), { w: 256, h: 192 });
  assert.deepEqual(jpegSize(jpegBytes(1, 65535)), { w: 1, h: 65535 });
});
test("壊れた・JPEGでないものは null: 先頭が違う・EOIで終わらない・SOFがない・SOFより前にデータ・長さがはみ出す・SOFが短い", () => {
  const ok = jpegBytes();
  assert.equal(jpegSize(new TextEncoder().encode("not an image at all")), null);
  assert.equal(jpegSize(ok.slice(0, ok.length - 2)), null, "EOIで終わらない");
  assert.equal(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9])), null, "SOFがない");
  assert.equal(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])), null, "SOFより前にデータが始まる");
  const longer = Uint8Array.from(ok); longer[4] = 0xff; longer[5] = 0xff; // APP0 の長さを大きくして、はみ出させる
  assert.equal(jpegSize(longer), null);
  assert.equal(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 5, 8, 0, 0xff, 0xd9])), null, "SOFが短い");
  assert.equal(jpegSize(new Uint8Array(0)), null);
});
test("保存できる画像: 16px以上〜上限以下。大きな画素数・極端に小さいものは拒否", () => {
  assert.equal(validAvatarJpeg(jpegBytes(256, 256)), true);
  assert.equal(validAvatarJpeg(jpegBytes(AVATAR_MAX_DIM, AVATAR_MAX_DIM)), true);
  assert.equal(validAvatarJpeg(jpegBytes(AVATAR_MAX_DIM + 1, 256)), false);
  assert.equal(validAvatarJpeg(jpegBytes(256, 5000)), false);
  assert.equal(validAvatarJpeg(jpegBytes(15, 256)), false);
  assert.equal(validAvatarJpeg(jpegBytes(65535, 65535)), false, "数千万画素は拒否");
});
