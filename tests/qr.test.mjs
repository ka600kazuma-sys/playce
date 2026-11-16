import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { qrMatrix, qrPath, QR_QUIET } from "../src/lib/domain/qr.ts";

// 描いたQRを、別のライブラリ(jsQR)で読み戻して、元のURLと一致することを確かめる(スマホのカメラで読めることの代わりの機械的な確認)。
function decode(text, scale = 6) {
  const m = qrMatrix(text), n = m.length, size = (n + QR_QUIET * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c])
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((r + QR_QUIET) * scale + dy) * size + (c + QR_QUIET) * scale + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0;
    }
  return jsQR(px, size, size)?.data ?? null;
}

const mac = "FC1Mjf-gZJ85rZAjNfxmvA05rukq0vgD";
const urls = [
  `https://playce--playce-e1455.asia-east1.hosted.app/stamp/t/bt9op1DDxPC2s3F9UfJ1/1.${mac}`,
  `https://playce--playce-e1455.asia-east1.hosted.app/stamp/t/zz_test_vis_0af8ba/12.${mac}`,
  `http://127.0.0.1:3000/stamp/t/e/1.${mac}`,
  "https://example.com/日本語",
];
test("QR: タグのURLを描いて読み戻すと、元のURLと完全に一致する", () => {
  for (const u of urls) assert.equal(decode(u), u, u);
});
test("QR: 別のURLは別のQRになり、読み戻しも混ざらない", () => {
  const a = urls[0], b = urls[0].replace("1." + mac, "2." + mac);
  assert.notEqual(qrPath(a).d, qrPath(b).d);
  assert.equal(decode(b), b);
});
test("QR: pathは数字・M h v z だけ(HTMLを作らない)。余白込みの大きさ", () => {
  const q = qrPath(urls[0]);
  assert.match(q.d, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  assert.equal(q.size, qrMatrix(urls[0]).length + QR_QUIET * 2);
});
test("QR: 空・長すぎる文字列は拒否", () => {
  assert.throws(() => qrMatrix(""));
  assert.throws(() => qrMatrix("a".repeat(501)));
});

// 画面に出す path(qrPath の結果)そのものを画像にして読み戻す。座標・横幅の計算が壊れていないことの確認。
function decodePath(text, scale = 6) {
  const { size, d } = qrPath(text), W = size * scale, px = new Uint8ClampedArray(W * W * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const x = +m[1], y = +m[2], len = +m[3];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < len * scale; dx++) { const i = ((y * scale + dy) * W + x * scale + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  }
  return jsQR(px, W, W)?.data ?? null;
}
test("QR: 画面に出す path を画像にして読み戻しても、元のURLと一致する", () => {
  for (const u of urls) assert.equal(decodePath(u), u, u);
});
