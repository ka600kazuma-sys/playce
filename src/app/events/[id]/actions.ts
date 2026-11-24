"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { membersUpdateSchema, registrationInputSchema } from "@/lib/domain/registration";
import { changeRegistration, createRegistration } from "@/lib/repo/registrations";
import { getMember } from "@/lib/auth/member";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { formTokenState } from "@/lib/domain/abuse";
import { formSecret } from "@/lib/repo/formtoken";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";

const members = (fd: FormData) => fd.getAll("members").map(String).map((s) => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === "production";

async function browserId() {
  const jar = await cookies();
  let id = jar.get("pbid")?.value;
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
    id = randomBytes(24).toString("base64url");
    jar.set("pbid", id, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return id;
}

export async function applyAction(eventId: string, fd: FormData) {
  const fail = (m: string): never => redirect(`/events/${eventId}/apply?err=${encodeURIComponent(m)}`);
  // 参加申込はログインが必要(サーバー側でも必ず確認する。画面を隠すだけでは保護にならない)
  const member = await getMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(`/events/${eventId}/apply`)}`);
  // ボット対策: 隠し欄(人間は入力しない)と、描画時刻の署名つきトークン(短すぎる入力時間を拒否)
  if (String(fd.get("website") ?? "") !== "") fail("申込を完了できませんでした。");
  const secret = formSecret();
  // ボット対策の最短の入力時間(1.5秒)に満たないときは、エラーにせず、足りない分だけ待ってから進める(自動入力・素早い操作で申込が失敗しないように)。
  if (!(await allow("apply", await requestIp()))) fail(BUSY);
  const raw = String(fd.get("_t") ?? "");
  const ft = secret ? formTokenState(secret, raw, Date.now(), 0) : "bad";
  if (ft === "expired") fail("入力画面を開いてから2時間以上たちました。お手数ですが、もう一度入力して、申し込んでください。");
  if (ft !== "ok") fail("フォームを確認できませんでした。画面を開き直して、もう一度お試しください。");
  const wait = 1500 - (Date.now() - Number(raw.split(".")[0]));
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 1500)));
  // 代表者のニックネームは、フォームの値ではなく、ログイン中のメンバーのニックネームを使う(なりすまし防止)
  const parsed = registrationInputSchema.safeParse({
    nickname: member!.nickname, members: members(fd),
    confirmDuplicate: true,
  });
  if (!parsed.success) redirect(`/events/${eventId}/apply?err=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const bid = await browserId();
  let res;
  try {
    res = await createRegistration(eventId, parsed.data, bid, { id: member!.id });
  } catch {
    redirect(`/events/${eventId}/apply?err=${encodeURIComponent("申込を完了できませんでした。時間をおいて再度お試しください。")}`);
  }
  if (!res.ok) {
    if (res.code === "already") redirect(`/events/${eventId}/mine?already=1`);
    redirect(`/events/${eventId}/apply?err=${encodeURIComponent(res.code === "closed" ? "このイベントは受付を終了しています。" : "イベントが見つかりません。")}`);
  }
  redirect(`/events/${eventId}/mine?new=1`);
}

export async function changeAction(eventId: string, token: string, change: "cancel" | "accept" | "decline" | "edit" | "keep", fd?: FormData) {
  if (!(await allow("manage", await requestIp()))) redirect(`/events/${eventId}/r/${token}?err=${encodeURIComponent(BUSY)}`);
  let edit;
  if (change === "edit" && fd) {
    const p = membersUpdateSchema.safeParse({ nickname: String(fd.get("nickname") ?? ""), members: members(fd) });
    if (!p.success) redirect(`/events/${eventId}/r/${token}?err=${encodeURIComponent(p.error.issues[0].message)}`);
    edit = p.data;
  }
  let result;
  try {
    result = await changeRegistration(eventId, token, change, edit);
  } catch {
    redirect(`/events/${eventId}/r/${token}?err=${encodeURIComponent("処理できませんでした。時間をおいて再度お試しください。")}`);
  }
  const msg: Record<string, string> = {
    ok: "", closed: "開催が始まっているため、変更できません。", invalid_state: "この状態では操作できません（人数を増やす場合は空き枠が必要です）。",
    expired: "回答期限が過ぎたため、繰上げは取り消されました。", not_found: "申込が見つかりません。",
  };
  redirect(`/events/${eventId}/r/${token}${msg[result] ? `?err=${encodeURIComponent(msg[result])}` : "?done=1"}`);
}
