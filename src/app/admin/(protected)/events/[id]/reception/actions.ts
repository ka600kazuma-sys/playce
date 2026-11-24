"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getMemberView } from "@/lib/repo/members";
import { adminAddRegistration, adminCancelRegistration } from "@/lib/repo/registrations";
import { applyStampDiscount, type ApplyResult } from "@/lib/repo/stamps";
import { issueTabletCode } from "@/lib/repo/furitasync";
import { decideWalkin } from "@/lib/repo/receptionqr";
import { redeemCoupon, type UseResult } from "@/lib/repo/stampadmin";
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
  retired: "スタンプ割引は、クーポン方式に変わりました。", ok: "", not_found: "対象が見つかりません。", invalid_state: "この操作はできません(すでに取消済み、または入力が正しくありません)。",
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

// スタンプ割引の適用(金額はサーバーで計算し直す。1人分の申込だけ。二重適用しない)。
const STAMP_MSG: Record<ApplyResult, string> = {
  retired: "スタンプ割引は、クーポン方式に変わりました。", ok: "", not_found: "対象が見つかりません。", closed: "会計が確定済みのため変更できません。会計画面で確定を解除してください。",
  no_discount: "この回は、割引がありません。", already: "すでに適用済みです。", group: "同行者がいるため、自動では適用できません。「個別料金を変更」で調整してください。",
  paid: "入金済みの額より低くなるため、適用できません。", off: "スタンプカードがOFFです。",
};
export async function stampDiscountAction(id: string, regId: string, fd: FormData) {
  const admin = await requireAdmin();
  const q = String(fd.get("q") ?? "").slice(0, 50);
  let res: ApplyResult | "error";
  try { res = await applyStampDiscount(id, regId, admin.email); } catch { res = "error"; }
  const qs = q ? `q=${encodeURIComponent(q)}&` : "";
  redirect(`/admin/events/${id}/reception?${qs}${res === "ok" ? "ok=1" : `err=${encodeURIComponent(res === "error" ? "処理できませんでした。時間をおいて再度お試しください。" : STAMP_MSG[res])}`}`);
}

// ---- 当日参加(QR)の承認待ち: 承認すると、定員・日時に関係なく受付済みの参加確定で登録する(管理者の追加に制限はない) ----
const to = (id: string, q: string, err?: string): never => redirect(`/admin/events/${id}/reception?${q ? `q=${encodeURIComponent(q)}&` : ""}${err ? `err=${encodeURIComponent(err)}` : "ok=1"}`);
export async function decideWalkinAction(id: string, memberId: string, approve: boolean, fd: FormData) {
  const admin = await requireAdmin();
  const q = String(fd.get("q") ?? "").slice(0, 50);
  let r: string;
  try { r = await decideWalkin(id, memberId, approve, admin.email); } catch { r = "error"; }
  to(id, q, r === "ok" ? undefined : r === "closed" ? "会計が確定済みのため承認できません。" : r === "not_found" ? "対象が見つかりません(すでに処理済みの可能性があります)。" : "処理できませんでした。時間をおいて再度お試しください。");
}
const COUPON_MSG: Record<UseResult, string> = {
  ok: "", not_found: "対象が見つかりません。", not_active: "このクーポンは、すでに使用済みか取り消されています。", expired: "有効期限が切れています。",
  same_day: "このクーポンは、発行されたイベントの当日には使えません(設定で変更できます)。", group: "同行者がいる申込には、自動では適用できません。「個別料金を変更」で調整してください。",
  already_has: "この申込には、すでにクーポンを適用しています(併用はできません)。", closed: "会計が確定済みのため変更できません。", paid: "入金済みの額より低くなるため、適用できません。",
  sport: "別の競技のクーポンです。", invalid: "入力が正しくありません。",
};
export async function useCouponAction(id: string, regId: string, fd: FormData) {
  const admin = await requireAdmin();
  const q = String(fd.get("q") ?? "").slice(0, 50);
  let r: UseResult | "error";
  try { r = await redeemCoupon(id, regId, String(fd.get("couponId") ?? ""), admin.email); } catch { r = "error"; }
  to(id, q, r === "ok" ? undefined : r === "error" ? "処理できませんでした。時間をおいて再度お試しください。" : COUPON_MSG[r]);
}

// ふりた用コードの発行(画面に1回表示するだけ。URLには載せない。DBにはハッシュのみ)。
export type TabletCodeState = { code?: string; error?: string };
export async function issueTabletCodeAction(id: string): Promise<TabletCodeState> {
  const admin = await requireAdmin();
  try { const r = await issueTabletCode(id, admin.email); return r ? { code: r.code } : { error: "イベントが見つかりません。" }; }
  catch { return { error: "発行できませんでした。時間をおいて再度お試しください。" }; }
}
