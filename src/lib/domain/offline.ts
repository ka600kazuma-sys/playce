// 通信断での一時記録(受付チェック・支払い)の判定。画面・保存に依存しない純粋関数。
export type OfflineOp =
  | { opId: string; type: "checkin"; regId: string; value: boolean; expect: boolean; label: string; state: "pending" | "held"; error?: string }
  | { opId: string; type: "pay"; regId: string; amountYen: number; label: string; state: "pending" | "held"; error?: string };

// 受付チェックの競合判定。記録時の値(expect)と現在値が違い、かつ目的の値でもなければ「他の端末で先に変更された」とみなして保留する。
export function classifyCheckIn(current: boolean, expect: boolean, value: boolean, force = false): "noop" | "apply" | "conflict" {
  if (current === value) return "noop";
  if (force || current === expect) return "apply";
  return "conflict";
}

export type RegLite = { id: string; checkedIn: boolean; balance: number };
// 未同期の操作を表示用に重ねる(同期前でも画面上は記録済みに見せ、「未同期」と区別できるようにする)。
export function overlay<T extends RegLite>(regs: T[], ops: OfflineOp[]): (T & { pending: boolean })[] {
  return regs.map((r) => {
    let c = r.checkedIn, b = r.balance, pending = false;
    for (const o of ops) {
      if (o.regId !== r.id || o.state !== "pending") continue;
      pending = true;
      if (o.type === "checkin") c = o.value; else b = Math.max(0, b - o.amountYen);
    }
    return { ...r, checkedIn: c, balance: b, pending };
  });
}

export const opCounts = (ops: OfflineOp[]) => ({ pending: ops.filter((o) => o.state === "pending").length, held: ops.filter((o) => o.state === "held").length });
// 操作ID(冪等性キー)。Firestore のドキュメントIDとして使える文字だけにする。
export const isOpId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(s);
