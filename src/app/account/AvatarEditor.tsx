"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// プロフィール画像(任意)。選んだ画像を 256px 四方の JPEG に縮小してから送る。
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const size = 256, c = document.createElement("canvas"); c.width = c.height = size;
  const s = Math.min(bmp.width, bmp.height), ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("fail"))), "image/jpeg", 0.85));
}

export default function AvatarEditor({ nickname, version }: { nickname: string; version: number | null }) {
  const router = useRouter(), input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const headers = { "x-requested-with": "playce" };
  async function pick(f: File | undefined) {
    if (!f) return; setErr(""); setBusy(true);
    try {
      const blob = await toJpeg(f);
      const r = await fetch("/account/avatar", { method: "PUT", headers: { ...headers, "Content-Type": "image/jpeg" }, body: blob });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch { setErr("画像を設定できませんでした。別の画像でお試しください。"); }
    setBusy(false); if (input.current) input.current.value = "";
  }
  async function remove() {
    setBusy(true); setErr("");
    try { const r = await fetch("/account/avatar", { method: "DELETE", headers }); if (!r.ok) throw new Error(); router.refresh(); } catch { setErr("削除できませんでした。"); }
    setBusy(false);
  }
  return (
    <div className="flex items-center gap-4">
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/account/avatar?v=${version}`} alt="プロフィール画像" width={72} height={72} className="h-[72px] w-[72px] rounded-full border border-line object-cover" />
      ) : (
        <div aria-hidden className="grid h-[72px] w-[72px] place-items-center rounded-full border border-line font-serif text-2xl text-navy">{nickname.slice(0, 1)}</div>
      )}
      <div className="space-y-1 text-sm">
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-2xl border border-line px-3 py-1.5">{version ? "画像を変更" : "画像を設定(任意)"}</button>
        {version && <button type="button" disabled={busy} onClick={remove} className="ml-2 rounded-2xl border border-line px-3 py-1.5 text-red-700">削除</button>}
        {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
      </div>
    </div>
  );
}
