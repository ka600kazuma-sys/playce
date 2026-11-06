"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { addExpense, setClosed, voidExpense } from "@/lib/repo/accounting";
import type { OpResult } from "@/lib/repo/reception";

const MSG: Record<OpResult, string> = {
  ok: "", not_found: "対象が見つかりません。", invalid: "入力が正しくありません（確定はイベント終了後のみできます）。",
  closed: "会計が確定済みのため変更できません。先に確定を解除してください。",
};
const back = (id: string, res: OpResult | "error"): never =>
  redirect(`/admin/events/${id}/accounting?${res === "ok" ? "ok=1" : `err=${encodeURIComponent(res === "error" ? "処理できませんでした。時間をおいて再度お試しください。" : MSG[res])}`}`);

async function run(id: string, fn: (by: string) => Promise<OpResult>): Promise<never> {
  const admin = await requireAdmin();
  let res: OpResult | "error";
  try { res = await fn(admin.email); } catch { res = "error"; }
  return back(id, res);
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addExpenseAction(id: string, fd: FormData) {
  return run(id, (by) => addExpense(id, s(fd, "key"), { category: s(fd, "category"), description: s(fd, "description"), amountYen: Number(s(fd, "amount") || "NaN") }, by));
}
export async function voidExpenseAction(id: string, expenseId: string, fd: FormData) {
  return run(id, (by) => voidExpense(id, expenseId, s(fd, "reason"), by));
}
export async function closeAction(id: string) { return run(id, (by) => setClosed(id, true, "", by)); }
export async function reopenAction(id: string, fd: FormData) { return run(id, (by) => setClosed(id, false, s(fd, "reason"), by)); }
