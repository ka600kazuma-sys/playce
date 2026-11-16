"use client";
import { useEffect, useRef, useState } from "react";

// 主催者のスマホ・タブレットの画面いっぱいにQRを出して、参加者のスマホで読み取ってもらう(紙に貼らないので、掲示したままになりにくい)。
// 白地・余白つきで、画面の短い辺に合わせて最大に表示する。表示中は、画面が暗くならないようにする(対応している端末のみ)。
// 閉じるのは「閉じる」ボタンか Esc(うっかり閉じないよう、背景のタップでは閉じない)。
// ネイティブの <dialog> を showModal() で開く: 背面の操作とフォーカスの移動を、ブラウザが止める(Tabでも外へ出ない)。
export function QrFullscreen({ d, size, title }: { d: string; size: number; title: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  // 開く/閉じる: state と <dialog> の状態をそろえる。Esc(cancel)・「閉じる」のどちらも、同じ終了処理を通り、起動元のボタンへフォーカスを戻す。
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  // 表示中: スクロールを止め、画面が暗くならないようにする。
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let lock: WakeLockSentinel | null = null, pending = false, stopped = false;
    const acquire = async () => {
      if (pending || lock || stopped) return; // 取得中・取得済みのときは、重ねて取らない
      pending = true;
      try {
        const l = await navigator.wakeLock?.request("screen");
        if (!l) return;
        if (stopped) { await l.release().catch(() => {}); return; } // 取得している間に閉じられたら、すぐ解放する
        lock = l;
        l.addEventListener("release", () => { if (lock === l) lock = null; }); // 画面を離れると自動で解放される(戻ったときに取り直す)
      } catch { /* 対応していない端末・省電力中は、そのまま表示する */ } finally { pending = false; }
    };
    void acquire();
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      document.body.style.overflow = prevOverflow;
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [open]);

  const side = "min(92vw, 68dvh)";
  return (
    <>
      <button ref={openerRef} type="button" onClick={() => setOpen(true)} className="rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800">QRを画面いっぱいに表示</button>
      <dialog
        ref={dialogRef} aria-label={title}
        onClose={() => { setOpen(false); openerRef.current?.focus(); }} // Esc でも、閉じるボタンでも、ここを通る
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-white p-3 backdrop:bg-white"
      >
        {open && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-lg font-bold">{title}</p>
            <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title} shapeRendering="crispEdges" style={{ width: side, height: side }} className="bg-white">
              <rect width={size} height={size} fill="#fff" />
              <path d={d} fill="#000" />
            </svg>
            <p className="text-center text-sm text-gray-700">参加者のスマホのカメラで、読み取ってもらってください。<br />読み取れないときは、この画面の明るさを上げてください。<br />このQRは、撮影・共有しないよう、参加者にお伝えください。</p>
            <button type="button" autoFocus onClick={() => dialogRef.current?.close()} className="rounded-2xl border border-gray-400 px-10 py-3 text-lg font-semibold">閉じる</button>
          </div>
        )}
      </dialog>
    </>
  );
}
