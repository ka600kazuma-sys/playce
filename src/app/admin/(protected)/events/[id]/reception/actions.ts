"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { addWalkIn, recordPayment, setCheckedIn, setFeeOverride, setPublicHidden, voidPayment, type OpResult } from "@/lib/repo/reception";

const MSG: Record<OpResult, string> = { ok: "", not_found: "対象が見つかりません。", invalid: "入力が正しくないか、支払い額が残額を超えています。", closed: "会計が確定済みのため変更できません。会計画面で確定を解除してください。" };
const go = (id: string, q: string, res: OpResult | "error"): never =>
  redirect(`/admin/events/${id}/reception?${q ? `q=${encodeURIComponent(q)}&` : ""}${res === "ok" ? "ok=1" : `err=${encodeURIComponent(res === "error" ? "処理できませんでした。時間をおいて再度お試しください。" : MSG[res])}`}`);
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || "NaN");

async function run(id: string, fd: FormData, fn: (by: string) => Promise<OpResult>): Promise<never> {
  const admin = await requireAdmin();
  const q = String(fd.get("q") ?? "").slice(0, 50);
  let res: OpResult | "error";
  try { res = await fn(admin.email); } catch { res = "error"; }
  return go(id, q, res);
}

export async function checkInAction(id: string, regId: string, value: boolean, fd: FormData) {
  return run(id, fd, (by) => setCheckedIn(id, regId, value, by));
}
export async function payAction(id: string, regId: string, fd: FormData) {
  return run(id, fd, (by) => recordPayment(id, String(fd.get("key") ?? ""), [{ regId, amountYen: num(fd.get("amount")) }], by));
}
// まとめ支払い: 選択した人の残額をまとめて受け取る
export async function groupPayAction(id: string, fd: FormData) {
  return run(id, fd, (by) => {
    const allocations = fd.getAll("reg").map(String).map((r) => ({ regId: r, amountYen: num(fd.get(`amount_${r}`)) }));
    return recordPayment(id, String(fd.get("key") ?? ""), allocations, by);
  });
}
export async function voidAction(id: string, paymentId: string, fd: FormData) {
  return run(id, fd, (by) => voidPayment(id, paymentId, String(fd.get("reason") ?? "").trim(), by));
}
export async function feeAction(id: string, regId: string, fd: FormData) {
  return run(id, fd, (by) => setFeeOverride(id, regId, num(fd.get("fee")), String(fd.get("reason") ?? "").trim(), by));
}
export async function walkInAction(id: string, fd: FormData) {
  return run(id, fd, (by) => addWalkIn(id, String(fd.get("nickname") ?? "").trim(), num(fd.get("partySize")), by));
}
export async function listVisibilityAction(id: string, regId: string, hidden: boolean, fd: FormData) {
  return run(id, fd, (by) => setPublicHidden(id, regId, hidden, by));
}
