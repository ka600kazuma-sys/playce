import { randomBytes } from "node:crypto";
// テスト用の、構造が正しい(SOI・APP0・SOF・SOS・EOI)小さな JPEG。画素の中身はでたらめ(表示は想定しない)。w, h は SOF に書く大きさ。
export function jpegBytes(w = 256, h = 256, extra = 64) {
  const be = (n) => [(n >> 8) & 255, n & 255];
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0, 17, 8, ...be(h), ...be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  const data = [...randomBytes(extra)].map((b) => (b === 0xff ? 0xfe : b));
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, ...sos, ...data, 0xff, 0xd9]);
}
