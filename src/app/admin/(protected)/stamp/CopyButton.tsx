"use client";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="rounded border px-3 py-1.5 text-sm"
        onClick={() => { navigator.clipboard.writeText(text).then(() => setMsg("コピーしました"), () => setMsg("コピーできませんでした。URLを選択してコピーしてください")); }}>URLをコピー</button>
      <span role="status" className="text-xs text-gray-600">{msg}</span>
    </span>
  );
}
