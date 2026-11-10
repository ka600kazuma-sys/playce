"use server";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { membersUpdateSchema } from "@/lib/domain/registration";
import { changeRegistrationById, getMemberRegistration } from "@/lib/repo/registrations";
import { allow, requestIp } from "@/lib/repo/ratelimit";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";
const MSG: Record<string, string> = {
  ok: "", closed: "開催が始まっているため、変更できません。", invalid_state: "この状態では操作できません（人数を増やす場合は空き枠が必要です）。",
  expired: "回答期限が過ぎたため、繰上げは取り消されました。", not_found: "申込が見つかりません。",
};
const members = (fd: FormData) => fd.getAll("members").map(String).map((s) => s.trim()).filter(Boolean);

// ログイン中のメンバー本人の申込だけを操作する。申込のIDは、クライアントから受け取らず、サーバーが本人の申込から求める。
export async function memberChangeAction(eventId: string, change: "cancel" | "accept" | "decline" | "edit" | "keep", fd?: FormData) {
  const back = (q: string): never => redirect(`/events/${eventId}/mine?${q}`);
  const m = await getMember();
  if (!m) redirect(`/login?next=${encodeURIComponent(`/events/${eventId}/mine`)}`);
  if (!(await allow("manage", await requestIp()))) back(`err=${encodeURIComponent(BUSY)}`);
  let result: string;
  try {
    const reg = await getMemberRegistration(eventId, m!.id);
    if (!reg) return back(`err=${encodeURIComponent(MSG.not_found)}`);
    let edit;
    if (change === "edit" && fd) {
      const p = membersUpdateSchema.safeParse({ nickname: m!.nickname, members: members(fd) });
      if (!p.success) return back(`err=${encodeURIComponent(p.error.issues[0].message)}`);
      edit = p.data;
    }
    result = await changeRegistrationById(eventId, reg.regId, change, edit, m!.id);
  } catch {
    return back(`err=${encodeURIComponent("処理できませんでした。時間をおいて再度お試しください。")}`);
  }
  back(MSG[result] ? `err=${encodeURIComponent(MSG[result])}` : "done=1");
}
