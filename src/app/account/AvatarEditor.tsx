"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AVATAR_MAX_BYTES } from "@/lib/domain/mypage";
import { clampCrop, initialCrop, panBy, rotateBy, sliderToZoom, transformFor, zoomBy, zoomToSlider, type Crop } from "@/lib/domain/photoCrop";

// プロフィール写真(任意)。選んだ写真を、枠の中で自由に調整(ドラッグで移動・ピンチ/スライダーで拡大縮小・回転)してから、256px 四方の JPEG にして送る。
// 写真は円形に表示されるため、プレビューには円の目安を出す(枠の四隅は、円の外に出る)。
const PREVIEW = 288; // プレビューの一辺(CSS px)
const OUT = 256;     // 送る画像の一辺(px)

function draw(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, crop: Crop, frame: number) {
  const t = transformFor(crop, bmp.width, bmp.height, frame);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, frame, frame);
  ctx.save(); ctx.translate(t.tx, t.ty); ctx.rotate(t.angle); ctx.scale(t.scale, t.scale); ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2); ctx.restore();
}
async function toJpeg(bmp: ImageBitmap, crop: Crop): Promise<Blob> {
  const c = document.createElement("canvas"); c.width = c.height = OUT;
  draw(c.getContext("2d")!, bmp, crop, OUT);
  for (const q of [0.85, 0.7, 0.55, 0.4]) { // 大きすぎるときは、画質を下げて小さくする
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));
    if (b && b.size <= AVATAR_MAX_BYTES) return b;
  }
  throw new Error("too_large");
}

export default function AvatarEditor({ nickname, version, photoPublic }: { nickname: string; version: number | null; photoPublic: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null), dialogRef = useRef<HTMLDialogElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), openerRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>(initialCrop());
  const [choice, setChoice] = useState(photoPublic); // 保存するときの「参加者一覧にも表示する」(初期値は、いまの設定。はじめは表示しない)
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const headers = { "x-requested-with": "playce" };

  // ダイアログの開閉(Esc でも、同じ終了処理を通る)
  useEffect(() => { const d = dialogRef.current; if (!d) return; if (bmp && !d.open) d.showModal(); if (!bmp && d.open) d.close(); }, [bmp]);

  // プレビューの描画: 写真と、円の目安(円の外を暗くする)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !bmp) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(PREVIEW * dpr);
    const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, bmp, crop, PREVIEW);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, PREVIEW, PREVIEW); ctx.arc(PREVIEW / 2, PREVIEW / 2, PREVIEW / 2 - 1, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(15,40,90,.42)"; ctx.fill("evenodd"); ctx.restore();
    ctx.beginPath(); ctx.arc(PREVIEW / 2, PREVIEW / 2, PREVIEW / 2 - 1, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  }, [bmp, crop]);

  const dims = useCallback(() => ({ w: bmp?.width ?? 1, h: bmp?.height ?? 1 }), [bmp]);
  const pan = useCallback((fx: number, fy: number) => setCrop((c) => { const { w, h } = dims(); return panBy(c, fx, fy, w, h, PREVIEW); }), [dims]);
  const zoom = useCallback((f: number) => setCrop((c) => { const { w, h } = dims(); return zoomBy(c, f, w, h, PREVIEW); }), [dims]);

  // マウスホイールで拡大縮小(ページが動かないよう、passive にしない)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !bmp) return;
    const on = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015)); };
    cv.addEventListener("wheel", on, { passive: false });
    return () => cv.removeEventListener("wheel", on);
  }, [bmp, zoom]);

  function down(e: React.PointerEvent<HTMLCanvasElement>) { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const m = pointers.current, prev = m.get(e.pointerId); if (!prev) return;
    const size = e.currentTarget.getBoundingClientRect().width || PREVIEW;
    if (m.size === 1) { pan((e.clientX - prev.x) / size, (e.clientY - prev.y) / size); }
    else if (m.size === 2) { // ピンチ: 2本の指の間隔で拡大縮小し、中心の動きで移動する
      const other = [...m.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0 && d1 > 0) zoom(d1 / d0);
      pan(((e.clientX - prev.x) / 2) / size, ((e.clientY - prev.y) / 2) / size);
    }
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) { pointers.current.delete(e.pointerId); }
  function key(e: React.KeyboardEvent<HTMLCanvasElement>) { // キーボード: 矢印で移動、+/- で拡大縮小
    const k = e.key; const step = 0.03;
    if (k === "ArrowLeft") pan(-step, 0); else if (k === "ArrowRight") pan(step, 0); else if (k === "ArrowUp") pan(0, -step); else if (k === "ArrowDown") pan(0, step);
    else if (k === "+" || k === "=") zoom(1.1); else if (k === "-") zoom(1 / 1.1); else return;
    e.preventDefault();
  }

  async function pick(f: File | undefined) {
    if (!f) return; setErr("");
    try { const b = await createImageBitmap(f); setCrop(initialCrop()); setChoice(photoPublic); setBmp(b); }
    catch { setErr("この画像は読み込めませんでした。別の画像でお試しください。"); }
    if (fileRef.current) fileRef.current.value = "";
  }
  function close() { bmp?.close?.(); setBmp(null); openerRef.current?.focus(); }
  async function save() {
    if (!bmp) return; setBusy(true); setErr("");
    try {
      const blob = await toJpeg(bmp, clampCrop(crop, bmp.width, bmp.height, PREVIEW));
      const r = await fetch(`/account/avatar?public=${choice ? 1 : 0}`, { method: "PUT", headers: { ...headers, "Content-Type": "image/jpeg" }, body: blob });
      if (!r.ok) throw new Error();
      close(); router.refresh();
    } catch { setErr("写真を設定できませんでした。別の写真でお試しください。"); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true); setErr("");
    try { const r = await fetch("/account/avatar", { method: "DELETE", headers }); if (!r.ok) throw new Error(); router.refresh(); } catch { setErr("削除できませんでした。"); }
    setBusy(false);
  }
  async function togglePublic() {
    // 公開にするときは、誰でも見られることを、もう一度確認する(保存の画面を通らずに、スイッチだけで公開できるため)。
    if (!photoPublic && !window.confirm("この写真が、カレンダーの参加者一覧に表示されます。カレンダーを見る人なら誰でも写真を見られ、保存される可能性があります。表示しますか?")) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/account/avatar", { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ public: !photoPublic }) });
      if (!r.ok) throw new Error(); router.refresh();
    } catch { setErr("設定を変えられませんでした。時間をおいて、もう一度お試しください。"); }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {version ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/account/avatar?v=${version}`} alt="プロフィール写真" width={72} height={72} className="h-[72px] w-[72px] rounded-full border border-line object-cover" />
        ) : (
          <div aria-hidden className="grid h-[72px] w-[72px] place-items-center rounded-full border border-line font-serif text-2xl text-navy">{nickname.slice(0, 1)}</div>
        )}
        <div className="space-y-1 text-sm">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button ref={openerRef} type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="rounded-2xl border border-line px-3 py-1.5">{version ? "写真を変更" : "写真を設定(任意)"}</button>
          {version && <button type="button" disabled={busy} onClick={remove} className="ml-2 rounded-2xl border border-line px-3 py-1.5 text-red-700">削除</button>}
          {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
        </div>
      </div>

      {version && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
          <div className="text-sm">
            <div className="font-semibold">カレンダーの参加者一覧に写真を表示</div>
            <p id="photo-public-desc" className="text-xs text-soft">{photoPublic ? "表示中です。カレンダーを見る人なら、誰でもこの写真を見られ、保存される可能性があります。" : "表示していません。写真は、あなただけが見られます。オンにすると、カレンダーを見る人なら誰でもこの写真を見られ、保存される可能性があります。"}</p>
          </div>
          <button type="button" role="switch" aria-checked={photoPublic} aria-label="カレンダーの参加者一覧に写真を表示" aria-describedby="photo-public-desc" disabled={busy} onClick={togglePublic}
            className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition ${photoPublic ? "bg-blue" : "bg-[#c9d0df]"}`}>
            <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${photoPublic ? "left-[25px]" : "left-[3px]"}`} />
          </button>
        </div>
      )}

      <dialog ref={dialogRef} aria-label="写真を調整" onClose={close} onCancel={(e) => { if (busy) e.preventDefault(); }} className="m-auto w-[min(94vw,420px)] max-w-none rounded-3xl bg-white p-4 shadow-2xl backdrop:bg-[rgba(10,18,40,.55)]">
        {bmp && (
          <div className="space-y-3">
            <h2 className="font-serif text-lg font-bold text-ink">写真を調整</h2>
            <canvas ref={canvasRef} tabIndex={0} aria-label="写真の位置と大きさ。ドラッグで移動、矢印キーで移動、プラスとマイナスのキーで拡大縮小"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
              style={{ width: "100%", maxWidth: PREVIEW, aspectRatio: "1 / 1", touchAction: "none", cursor: "grab" }} className="mx-auto block rounded-2xl border border-line bg-white" />
            <p className="text-center text-xs text-soft">ドラッグで位置を動かし、ピンチ(またはスライダー)で拡大・縮小できます。白い円の中が、表示される範囲です。</p>
            <label className="flex items-center gap-3 text-sm">
              <span className="shrink-0">小さく</span>
              <input type="range" min={0} max={100} step={1} value={zoomToSlider(crop.zoom)} aria-label="拡大・縮小"
                onChange={(e) => setCrop((c) => clampCrop({ ...c, zoom: sliderToZoom(Number(e.target.value)) }, bmp.width, bmp.height, PREVIEW))} className="w-full" />
              <span className="shrink-0">大きく</span>
            </label>
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              <button type="button" onClick={() => setCrop((c) => rotateBy(c, -1, bmp.width, bmp.height, PREVIEW))} className="rounded-2xl border border-line px-3 py-1.5">↺ 左に回転</button>
              <button type="button" onClick={() => setCrop((c) => rotateBy(c, 1, bmp.width, bmp.height, PREVIEW))} className="rounded-2xl border border-line px-3 py-1.5">右に回転 ↻</button>
              <button type="button" onClick={() => setCrop(initialCrop())} className="rounded-2xl border border-line px-3 py-1.5">リセット</button>
            </div>
            <label className="flex items-start gap-2 rounded-2xl bg-tint p-3 text-sm">
              <input type="checkbox" checked={choice} onChange={(e) => setChoice(e.target.checked)} className="mt-1 h-5 w-5" />
              <span>カレンダーの参加者一覧にも表示する<br /><span className="text-xs text-soft">表示すると、カレンダーを見る人なら誰でもこの写真を見られ、保存される可能性があります。顔写真でなくてもかまいません。あとから、いつでも非表示にできます。</span></span>
            </label>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()} className="flex-1 rounded-2xl border border-line p-3 font-semibold">キャンセル</button>
              <button type="button" disabled={busy} onClick={save} className="flex-1 rounded-2xl bg-navy-deep p-3 font-semibold text-white">{busy ? "保存中…" : "この内容で保存"}</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
