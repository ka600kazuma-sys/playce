"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 公開・再公開をすばやく反映するため、画面が見えている間だけ一定間隔でサーバーの最新を取り直す(ポーリング)。
export default function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    const onVis = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [router, seconds]);
  return null;
}
