import "server-only";
import { db } from "@/lib/firebase/admin";
import { EXPENSE_CATEGORIES } from "@/lib/domain/accounting";
import type { OpResult } from "@/lib/repo/reception";

// 管理者専用。呼び出し側で requireAdmin() を済ませること。
export type ExpenseView = { id: string; at: number; by: string; category: string; description: string; amountYen: number; voided: boolean; voidReason?: string };
export type AccountingState = { closed: boolean; closedAt?: number; closedBy?: string; history: { at: number; by: string; action: "close" | "reopen"; reason?: string }[] };

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const acct = (id: string) => db().collection("accounting").doc(id);
const exp = (eventId: string) => db().collection("events").doc(eventId).collection("expenses");

export async function listExpenses(eventId: string): Promise<ExpenseView[]> {
  if (!validId(eventId)) return [];
  const snap = await exp(eventId).orderBy("at", "desc").limit(300).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ExpenseView, "id">) }));
}

export async function getAccounting(eventId: string): Promise<AccountingState> {
  const s = validId(eventId) ? await acct(eventId).get() : null;
  const d = s?.exists ? (s.data() as Partial<AccountingState>) : {};
  return { closed: d.closed === true, closedAt: d.closedAt, closedBy: d.closedBy, history: d.history ?? [] };
}

export async function addExpense(eventId: string, key: string, input: { category: string; description: string; amountYen: number }, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(key) || !(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)
    || input.description.length < 1 || input.description.length > 100
    || !Number.isInteger(input.amountYen) || input.amountYen < 1 || input.amountYen > 10_000_000) return "invalid";
  const ref = exp(eventId).doc(key); // 冪等性キー: 同じキーの再送は二重に記録しない
  return db().runTransaction(async (tx) => {
    const [dup, closed, ev] = await Promise.all([tx.get(ref), tx.get(acct(eventId)), tx.get(db().collection("events").doc(eventId))]);
    if (!ev.exists) return "not_found";
    if (dup.exists) return "ok";
    if (closed.exists && (closed.data() as { closed?: boolean }).closed) return "closed";
    tx.create(ref, { at: Date.now(), by, ...input, voided: false });
    return "ok";
  });
}

export async function voidExpense(eventId: string, expenseId: string, reason: string, by: string): Promise<OpResult> {
  if (!validId(eventId) || !validId(expenseId) || reason.length < 1 || reason.length > 200) return "invalid";
  const ref = exp(eventId).doc(expenseId);
  return db().runTransaction(async (tx) => {
    const [s, closed] = await Promise.all([tx.get(ref), tx.get(acct(eventId))]);
    if (!s.exists) return "not_found";
    if (closed.exists && (closed.data() as { closed?: boolean }).closed) return "closed";
    if ((s.data() as { voided?: boolean }).voided) return "ok";
    tx.update(ref, { voided: true, voidReason: reason, voidedAt: Date.now(), voidedBy: by });
    return "ok";
  });
}

// 会計の確定・解除。確定中は入金・経費・料金を変更できない。解除には理由が必要で、履歴に残る。
export async function setClosed(eventId: string, closed: boolean, reason: string, by: string): Promise<OpResult> {
  if (!validId(eventId) || (!closed && (reason.length < 1 || reason.length > 200))) return "invalid";
  const ref = acct(eventId);
  return db().runTransaction(async (tx) => {
    const [s, ev] = await Promise.all([tx.get(ref), tx.get(db().collection("events").doc(eventId))]);
    if (!ev.exists) return "not_found";
    const cur = s.exists ? (s.data() as Partial<AccountingState>) : {};
    if ((cur.closed === true) === closed) return "ok";
    if (closed && new Date((ev.data() as { endAt: string }).endAt) > new Date()) return "invalid"; // 終了前は確定できない
    const history = [...(cur.history ?? []), { at: Date.now(), by, action: closed ? "close" : "reopen", ...(closed ? {} : { reason }) }];
    tx.set(ref, { closed, ...(closed ? { closedAt: Date.now(), closedBy: by } : {}), history });
    return "ok";
  });
}
