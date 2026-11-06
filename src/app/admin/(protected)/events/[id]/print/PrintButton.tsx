"use client";
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="w-full rounded bg-black p-3 font-semibold text-white">印刷 / PDFに保存</button>;
}
