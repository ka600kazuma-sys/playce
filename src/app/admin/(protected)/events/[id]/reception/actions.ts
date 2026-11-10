"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getMemberView } from "@/lib/repo/members";
import { adminAddRegistration, adminCancelRegistration } from "@/lib/repo/registrations";
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

// ---- 参加者の追加・削除(メンバーの追加は、定員に関係なく「参加確定」。削除は取消で、開始前なら空いた枠にキャンセル待ちが繰り上がる) ----
const MSG2: Record<string, string> = {
  ok: "", not_found: "対象が見つかりません。", invalid_state: "この操作はできません(すでに取消済み、または入力が正しくありません)。",
  paid: "入金済みのため削除できません。先に、下の入金履歴で入金を取り消してください。", duplicate: "このメンバーは、すでにこのイベントに申込済みです。",
};
async function runAdmin(id: string, fd: FormData, fn: (by: string) => Promise<string>): Promise<never> {
  const admin = await requireAdmin();
  const q = String(fd.get("q") ?? "").slice(0, 50);
  let res: string;
  try { res = await fn(admin.email); } catch { res = "error"; }
  const msg = res === "ok" ? "ok=1" : `err=${encodeURIComponent(MSG2[res] ?? "処理できませんでした。時間をおいて再度お試しください。")}`;
  return redirect(`/admin/events/${id}/reception?${q ? `q=${encodeURIComponent(q)}&` : ""}${msg}`);
}

export async function addMemberParticipantAction(id: string, fd: FormData) {
  return runAdmin(id, fd, async (by) => {
    const m = await getMemberView(String(fd.get("memberId") ?? ""));
    if (!m) return "not_found";
    return adminAddRegistration(id, { memberId: m.id, nickname: m.nickname, partySize: num(fd.get("partySize")) }, by);
  });
}

export async function removeParticipantAction(id: string, regId: string, fd: FormData) {
  return runAdmin(id, fd, async (by) => (fd.get("confirm") === "on" ? adminCancelRegistration(id, regId, by) : "invalid_state"));
}
