// 受付・会計の計算(画面・保存に依存しない)。金額は円の整数。
export type RegMoney = { partySize: number; feeYen: number; paidYen: number };

export const amountDue = (r: Pick<RegMoney, "partySize" | "feeYen">) => r.partySize * r.feeYen;
export const balance = (r: RegMoney) => amountDue(r) - r.paidYen;

// 予定額(申込時の料金×人数)と入金実績は分けて集計する。
export function totals(rows: (RegMoney & { counts: boolean })[]) {
  let expected = 0, received = 0;
  for (const r of rows) {
    if (r.counts) expected += amountDue(r);
    received += r.paidYen;
  }
  return { expected, received, outstanding: expected - received };
}

// ニックネーム(代表者・同行者)の部分一致検索。全角/半角・大文字小文字を区別しない。
export const norm = (s: string) => s.normalize("NFKC").toLowerCase();
export function matches(q: string, names: string[]) {
  const n = norm(q.trim());
  return n === "" || names.some((x) => norm(x).includes(n));
}

// CSV の式インジェクション対策(= + - @ で始まるセルを無効化)とクォート。
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
