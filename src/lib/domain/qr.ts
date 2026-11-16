// QRコード(タグURLの表示用)。ライブラリ: qrcode-generator(MIT・依存なし)。画面には、<path> として描く(HTMLの文字列は作らない)。
import qrcode from "qrcode-generator";

export const QR_QUIET = 4; // QRの規格で決まっている余白(モジュール4つ分)

// 誤り訂正 M(約15%)。URLは100文字前後なので、型番は自動で決まる。
export function qrMatrix(text: string): boolean[][] {
  if (text.length === 0 || text.length > 500) throw new Error("qr: invalid length");
  qrcode.stringToBytes = (t: string) => [...new TextEncoder().encode(t)]; // 既定は1文字=1バイトで、日本語などが壊れるため、UTF-8 にする(URLは英数字だが、念のため)
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// 黒いモジュールを、横の連なりごとの四角にまとめた SVG の path。size は余白込みの一辺。
export function qrPath(text: string): { size: number; d: string } {
  const m = qrMatrix(text), n = m.length;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!m[y][x]) { x++; continue; }
      let len = 1;
      while (x + len < n && m[y][x + len]) len++;
      d += `M${x + QR_QUIET} ${y + QR_QUIET}h${len}v1h-${len}z`;
      x += len;
    }
  }
  return { size: n + QR_QUIET * 2, d };
}
