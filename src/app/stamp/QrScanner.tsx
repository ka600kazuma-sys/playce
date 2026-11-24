"use client";
import { useEffect, useRef, useState } from "react";
import { stampPathFromQr } from "@/lib/domain/stampqr";

// アプリ内のカメラで、主催者の画面に出たスタンプのQRを読み取る。読み取ったURLが、このサイトのスタンプのURLのときだけ、そのURLを開く(付与はサーバー側で、ログイン・署名・1回だけを確認する)。
// カメラの映像は、端末の外へ送らない。jsQR(ブラウザ内で解読)は、開いたときに読み込む。
export default function QrScanner() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current; if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let stopped = false, stream: MediaStream | null = null, raf = 0, last = 0;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    (async () => {
      setMsg("");
      if (!navigator.mediaDevices?.getUserMedia) { setMsg("この端末・ブラウザでは、カメラを使えません。スマホのカメラアプリでQRを読み取ってください。"); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current!; v.srcObject = s; v.setAttribute("playsinline", "true"); await v.play();
        const jsQR = (await import("jsqr")).default;
        const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = (t: number) => {
          if (stopped) return;
          raf = requestAnimationFrame(tick);
          if (t - last < 120 || v.videoWidth === 0) return; // 1秒に8回ほど
          last = t;
          // 解析するのは、画面の枠に当たる、映像の中央の正方形だけ(枠の外にあるQRを読まない)。
          const side = Math.floor(Math.min(v.videoWidth, v.videoHeight) * 0.62), sx = Math.floor((v.videoWidth - side) / 2), sy = Math.floor((v.videoHeight - side) / 2);
          const out = Math.min(side, 480);
          canvas.width = out; canvas.height = out;
          ctx.drawImage(v, sx, sy, side, side, 0, 0, out, out);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (!r?.data) return;
          const path = stampPathFromQr(r.data, location.origin);
          if (path) { stop(); setMsg("読み取りました…"); location.assign(path); }
          else setMsg("スタンプのQRではありません。主催者の画面のQRを読み取ってください。");
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as { name?: string }).name;
        setMsg(name === "NotAllowedError" ? "カメラの使用が許可されていません。端末の設定で、このアプリ(またはブラウザ)のカメラを許可してください。" : name === "NotFoundError" ? "カメラが見つかりません。" : "カメラを起動できませんでした。もう一度お試しください。");
      }
    })();
    return stop;
  }, [open]);

  return (
    <>
      <button type="button" className="st-scan" onClick={() => setOpen(true)}>QRを読み取る</button>
      <dialog ref={dialogRef} aria-label="スタンプのQRを読み取る" onClose={() => setOpen(false)} className="st-scandlg">
        {open && (
          <div className="st-scanbox">
            <video ref={videoRef} muted playsInline className="st-video" />
            <div className="st-frame" aria-hidden="true" />
            <p className="st-scanmsg" role="status">{msg || "主催者の画面のQRを、枠の中に写してください"}</p>
            <button type="button" autoFocus onClick={() => setOpen(false)} className="st-scanclose">閉じる</button>
          </div>
        )}
      </dialog>
    </>
  );
}
