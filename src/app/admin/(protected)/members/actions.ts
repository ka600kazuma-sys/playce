"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createMember, deleteMemberRecord, renameMember, setMemberPassword } from "@/lib/repo/members";
import { adminCancelRegistration, upcomingMemberRegistrations } from "@/lib/repo/registrations";

// 管理用の Server Action は、必ず requireAdmin() で始める(画面を隠すだけでは保護にならない)。
const enc = encodeURIComponent;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const toList = (q: string): never => redirect(`/admin/members?${q}`);

export async function addMemberAction(fd: FormData) {
  await requireAdmin();
  let r;
  try { r = await createMember(text(fd, "nickname"), text(fd, "password"), "admin"); } catch { return toList(`err=${enc("追加できませんでした。時間をおいて再度お試しください。")}`); }
  toList(r.ok ? "done=added" : `err=${enc(r.message)}`);
}

export async function renameMemberAction(id: string, fd: FormData) {
  await requireAdmin();
  let r;
  try { r = await renameMember(id, text(fd, "nickname")); } catch { r = { ok: false as const, message: "変更できませんでした。" }; }
  toList(r.ok ? "done=renamed" : `err=${enc(r.message)}`);
}

// パスワードの再設定(本人が忘れたとき)。設定すると、そのメンバーの、すべての端末のログインが無効になる。
export async function resetMemberPasswordAction(id: string, fd: FormData) {
  await requireAdmin();
  let r;
  try { r = await setMemberPassword(id, text(fd, "password")); } catch { r = { ok: false as const, message: "再設定できませんでした。" }; }
  toList(r.ok ? "done=reset" : `err=${enc(r.message)}`);
}

// メンバーの削除。これから開催される申込は取消(開始前なら、空いた枠にキャンセル待ちを繰り上げ)。入金済みの申込があるときは拒否する。
export async function deleteMemberAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const back = (m: string): never => redirect(`/admin/members/${id}/delete?err=${enc(m)}`);
  if (fd.get("confirm") !== "on") return back("「元に戻せないことを理解しました」にチェックを入れてください。");
  try {
    const upcoming = await upcomingMemberRegistrations(id);
    if (upcoming.some((u) => u.paidYen > 0)) return back("入金済みの申込があるため、削除できません。先に、受付画面で入金を取り消してください。");
    let cancelled = 0;
    for (const u of upcoming) if ((await adminCancelRegistration(u.eventId, u.regId, admin.email)) === "ok") cancelled++;
    const r = await deleteMemberRecord(id, admin.email, cancelled);
    if (r === "not_found") return toList(`err=${enc("メンバーが見つかりません。")}`);
  } catch { return back("削除できませんでした。時間をおいて再度お試しください。"); }
  toList("done=deleted");
}
