"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { opCounts, overlay, type OfflineOp } from "@/lib/domain/offline";
import { matches } from "@/lib/domain/reception";

type Reg = { id: string; nickname: string; members: string[]; partySize: number; checkedIn: boolean; balance: number; reconfirm: boolean };
const yen = (n: number) => `${n.toLocaleString()}円`;
const newOpId = () => `op${crypto.randomUUID().replaceAll("-", "")}`;

// クイック受付: 読み込み済みの一覧で、受付チェックと全額支払いを記録する。
// 通信が切れても端末(localStorage)に一時記録し、復旧後に同期する。競合は保留にして主催者が判断する。
export function QuickReception({ eventId, regs }: { eventId: string; regs: Reg[] }) {
  const router = useRouter();
  const key = `playce.recq.${eventId}`;
  const [ops, setOps] = useState<OfflineOp[]>([]);
  const [online, setOnline] = useState(true);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const busy = useRef(false);
  const opsRef = useRef<OfflineOp[]>([]);

  const save = useCallback((next: OfflineOp[]) => {
    opsRef.current = next; setOps(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 保存できない環境では画面上のみ */ }
  }, [key]);

  const post = useCallback(async (op: OfflineOp, force = false): Promise<"ok" | "conflict" | "invalid" | "network" | "auth"> => {
    try {
      const body = op.type === "checkin"
        ? { eventId, opId: op.opId, type: "checkin", regId: op.regId, value: op.value, expect: op.expect, force }
        : { eventId, opId: op.opId, type: "pay", regId: op.regId, amountYen: op.amountYen };
      const r = await fetch("/api/reception", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "playce" }, body: JSON.stringify(body) });
      if (r.ok) return "ok"; if (r.status === 409) return "conflict"; if (r.status === 401 || r.status === 403) return "auth"; return "invalid";
    } catch { return "network"; }
  }, [eventId]);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let changed = false, next = [...opsRef.current];
      for (const op of [...next]) {
        if (op.state !== "pending") continue;
        const res = await post(op);
        if (res === "network") { setOnline(false); break; }
        setOnline(true);
        if (res === "auth") { setMsg("ログインの有効期限が切れました。再ログインしてください。"); break; }
        changed = true;
        next = res === "ok" ? next.filter((o) => o.opId !== op.opId)
          : next.map((o) => (o.opId === op.opId ? { ...o, state: "held" as const, error: res === "conflict" ? "他の端末で先に変更されています" : "記録できませんでした(残額超過・会計確定済みなど)" } : o));
        save(next);
      }
      if (changed) router.refresh();
    } finally { busy.current = false; }
  }, [post, router, save]);

  useEffect(() => {
    let saved: OfflineOp[] = [];
    try { saved = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { saved = []; }
    opsRef.current = Array.isArray(saved) ? saved : [];
    // 保存済みの未同期操作を読み込み、同期を試みる(外部ストレージとの同期のための初期化)
    setOps(opsRef.current); setOnline(navigator.onLine);
    void flush();
    const on = () => { setOnline(true); void flush(); }, off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("focus", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("focus", on); };
  }, [key, flush]);

  const enqueue = (op: OfflineOp) => { save([...opsRef.current, op]); setMsg(""); void flush(); };
  const rows = overlay(regs, ops);
  const shown = rows.filter((r) => matches(q, [r.nickname, ...r.members]));
  const c = opCounts(ops), held = ops.filter((o) => o.state === "held");

  return (
    <section className="space-y-2 rounded border p-3" aria-label="クイック受付">
      <h2 className="text-sm font-semibold">クイック受付(通信が切れても記録できます)</h2>
      {(!online || c.pending > 0 || c.held > 0) && (
        <div role="status" className={`space-y-2 rounded border p-2 text-sm ${c.held ? "border-red-400" : "border-blue-400"}`}>
          {!online && <p>オフラインです。読み込み済みの一覧で記録し、復旧後に自動で同期します。</p>}
          <p>未同期 {c.pending}件 / 保留 {c.held}件 <button type="button" onClick={() => void flush()} className="ml-2 rounded border px-3 py-1">今すぐ同期</button></p>
          {held.map((o) => (
            <div key={o.opId} className="border-t pt-2">
              <p className="text-red-700">{o.label}: {o.error}</p>
              <div className="flex gap-2">
                {o.type === "checkin" && <button type="button" className="rounded border px-3 py-1" onClick={async () => { const r = await post(o, true); if (r === "ok") { save(opsRef.current.filter((x) => x.opId !== o.opId)); router.refresh(); } else setMsg("適用できませんでした。"); }}>この変更を適用</button>}
                <button type="button" className="rounded border px-3 py-1" onClick={() => save(opsRef.current.filter((x) => x.opId !== o.opId))}>破棄</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ニックネームで絞り込み" className="w-full rounded border p-3 text-base" autoComplete="off" aria-label="絞り込み" />
      <ul className="space-y-2">
        {shown.length === 0 && <li className="text-sm text-gray-500">該当する参加者がいません。</li>}
        {shown.map((r) => {
          const raw = regs.find((x) => x.id === r.id)!;
          return (
            <li key={r.id} className="space-y-1 rounded border p-2">
              <div className="font-semibold">{r.nickname} <span className="text-sm font-normal">{r.partySize}人</span>
                {r.pending && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-normal">未同期</span>}
                {r.reconfirm && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-normal">日程の継続確認待ち</span>}</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={r.checkedIn} className={`rounded border px-4 py-2 ${r.checkedIn ? "bg-green-100" : ""}`}
                  onClick={() => enqueue({ opId: newOpId(), type: "checkin", regId: r.id, value: !r.checkedIn, expect: raw.checkedIn, label: `${r.nickname}の受付`, state: "pending" })}>
                  {r.checkedIn ? "受付済み(取り消す)" : "受付する"}
                </button>
                {r.balance > 0
                  ? <button type="button" className="rounded border px-4 py-2" onClick={() => enqueue({ opId: newOpId(), type: "pay", regId: r.id, amountYen: r.balance, label: `${r.nickname}の支払い`, state: "pending" })}>残額 {yen(r.balance)} を受け取る</button>
                  : <span className="px-2 py-2 text-sm">支払い済み</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500">一部だけの支払い・個別料金・取消・飛び入りは、下の通常のフォーム(オンライン時)で行います。</p>
    </section>
  );
}
