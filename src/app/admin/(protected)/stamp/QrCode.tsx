import { qrPath } from "@/lib/domain/qr";

// タグのURLのQRコード。NFCが使えない端末向け(スマホのカメラで読むと、タグと同じURLが開く)。印刷しても使える。
export function QrCode({ text, label }: { text: string; label: string }) {
  let q: { size: number; d: string };
  try { q = qrPath(text); } catch { return <p className="text-xs text-red-700">QRコードを作れませんでした。</p>; }
  return (
    <svg viewBox={`0 0 ${q.size} ${q.size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="h-44 w-44 border border-gray-300 bg-white">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}
