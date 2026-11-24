"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { adminAdjustPoints, adminCancelCoupon, adminIssueCoupon, setStampSettings } from "@/lib/repo/stampadmin";

// すべて requireAdmin() から始める。入力は repo 側で検証する(理由は一覧から選択・必須。個数は±100まで)。
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(s(fd, k) || "NaN");
const back = (memberId: string, msg: string, kind: "ok" | "err" = "err", warn = ""): never => redirect(`/admin/stamp/members?m=${encodeURIComponent(memberId)}&${kind}=${encodeURIComponent(msg)}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`);

export async function adjustAction(memberId: string, fd: FormData) {
  const admin = await requireAdmin();
  const sign = s(fd, "dir") === "revoke" ? -1 : 1;
  let r;
  try { r = await adminAdjustPoints({ memberId, sport: s(fd, "sport"), count: sign * n(fd, "count"), reason: s(fd, "reason"), note: s(fd, "note"), opId: s(fd, "opId"), confirm: fd.get("confirm") === "on", expect: s(fd, "expect"), by: admin.email }); }
  catch { return back(memberId, "処理できませんでした。時間をおいて再度お試しください。"); }
  if (r.result === "ok") return back(memberId, r.couponsIssued ? `ポイントを反映し、クーポンを${r.couponsIssued}枚発行しました。` : "ポイントを反映しました。", "ok");
  if (r.result === "duplicate") return back(memberId, "この操作は、すでに処理済みです。", "ok");
  if (r.result === "needs_confirm") {
    const used = r.affected?.filter((c) => c.status === "used").length ?? 0, un = (r.affected?.length ?? 0) - used;
    return back(memberId, `警告: この取り消しで、発行済みのクーポンと合わなくなります(未使用${un}枚・使用済み${used}枚)。未使用のクーポンは取り消し、使用済みはそのまま残します。実行するには「確認しました」にチェックを入れて、もう一度押してください。`, "err", r.expectKey ?? "");
  }
  return back(memberId, r.result === "not_found" ? "会員が見つかりません。" : "入力が正しくありません(理由は必須・個数は1〜100・取り消せるポイントがあること)。");
}
export async function issueCouponAction(memberId: string, fd: FormData) {
  const admin = await requireAdmin();
  let r;
  try { r = await adminIssueCoupon({ memberId, sport: s(fd, "sport"), kind: s(fd, "kind") === "free" ? "free" : "discount", yen: n(fd, "yen") || 0, reason: s(fd, "reason"), note: s(fd, "note"), opId: s(fd, "opId"), by: admin.email }); }
  catch { return back(memberId, "処理できませんでした。時間をおいて再度お試しください。"); }
  return r === "ok" || r === "duplicate" ? back(memberId, "クーポンを発行しました。", "ok") : back(memberId, "入力が正しくありません(割引額は1〜100000円・理由は必須)。");
}
export async function cancelCouponAction(memberId: string, couponId: string, fd: FormData) {
  const admin = await requireAdmin();
  let r;
  try { r = await adminCancelCoupon(couponId, s(fd, "reason"), admin.email); } catch { return back(memberId, "処理できませんでした。時間をおいて再度お試しください。"); }
  return r === "ok" ? back(memberId, "クーポンを取り消しました。", "ok") : back(memberId, r === "used" ? "使用済みのクーポンは取り消せません。" : "入力が正しくありません(理由は必須)。");
}

// 特典内容・クーポン運用の設定(奇数周/偶数周の3pt・5pt。未確定事項は、ここで切り替える)
const reward = (fd: FormData, k: string) => (s(fd, `${k}_kind`) === "free" ? { kind: "free" } : { kind: "discount", yen: n(fd, `${k}_yen`) });
export async function saveSettingsAction(fd: FormData) {
  const admin = await requireAdmin();
  const days = s(fd, "expiryDays");
  const input = { rewards: { odd: { 3: reward(fd, "odd3"), 5: reward(fd, "odd5") }, even: { 3: reward(fd, "even3"), 5: reward(fd, "even5") } }, sameDay: fd.get("sameDay") === "on", expiryDays: days === "" ? null : Number(days) };
  let r: "ok" | "invalid" | "error";
  try { r = await setStampSettings(input, admin.email); } catch { r = "error"; }
  redirect(r === "ok" ? "/admin/stamp/settings?ok=1" : `/admin/stamp/settings?err=${r === "invalid" ? "1" : "2"}`);
}
