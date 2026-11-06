export const EXPENSE_CATEGORIES = ["会場費", "備品購入", "消耗品", "交通費", "その他"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type Expense = { amountYen: number; category: string; voided: boolean };
export type Payment = { amountYen: number; voided: boolean };

// 売上=取消されていない入金の合計、経費=取消されていない経費の合計。
// 取引は入金・経費それぞれ1件のドキュメントだけが元データなので、二重に計上されない。
export function summarize(payments: Payment[], expenses: Expense[]) {
  const revenue = payments.filter((p) => !p.voided).reduce((n, p) => n + p.amountYen, 0);
  const live = expenses.filter((e) => !e.voided);
  const cost = live.reduce((n, e) => n + e.amountYen, 0);
  const byCategory: Record<string, number> = {};
  for (const e of live) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amountYen;
  return { revenue, expenses: cost, profit: revenue - cost, byCategory };
}
