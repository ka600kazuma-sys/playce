"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MEMBER_COOKIE, clearMemberCookie, getMember, setMemberCookie } from "@/lib/auth/member";
import { nicknameKey, safeNext } from "@/lib/domain/member";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { authenticateMember, changeMemberPassword, createMember, createMemberSession, deleteMemberSession, getMemberPasswordHash, renameMember } from "@/lib/repo/members";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signupAction(fd: FormData) {
  const next = safeNext(text(fd, "next"));
  const fail = (m: string): never => redirect(`/signup?err=${enc(m)}&next=${enc(next)}`);
  if (text(fd, "website") !== "") fail("登録できませんでした。");
  if (!(await allow("signup", await requestIp()))) fail(BUSY);
  const nickname = text(fd, "nickname"), password = text(fd, "password");
  if (password !== text(fd, "password2")) fail("パスワードが一致しません。もう一度入力してください。");
  let r;
  try { r = await createMember(nickname, password, "self"); } catch { return fail("登録できませんでした。時間をおいて再度お試しください。"); }
  if (!r.ok) fail(r.message);
  const id = (r as { ok: true; id: string }).id;
  const hash = await getMemberPasswordHash(id);
  if (!hash) fail("登録できませんでした。ログイン画面からお試しください。");
  await setMemberCookie((await createMemberSession(id, hash!)).token);
  redirect(next);
}

export async function loginAction(fd: FormData) {
  const next = safeNext(text(fd, "next"));
  const fail = (m: string): never => redirect(`/login?err=${enc(m)}&next=${enc(next)}`);
  const nickname = text(fd, "nickname"), password = text(fd, "password");
  // IPごと・ニックネームごと(分散した総当たり対策)の回数制限。どちらが違うのかは伝えない。
  if (!(await allow("memberlogin", await requestIp())) || !(await allow("nicklogin", nicknameKey(nickname)))) fail(BUSY);
  let who;
  try { who = await authenticateMember(nickname, password); } catch { return fail("ログインできませんでした。時間をおいて再度お試しください。"); }
  if (!who) { await sleep(800); fail("ニックネームまたはパスワードが違います。"); }
  await setMemberCookie((await createMemberSession(who!.id, who!.passwordHash)).token);
  redirect(next);
}

export async function logoutAction() {
  const v = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (v) { try { await deleteMemberSession(v); } catch { /* Cookie は消す */ } }
  await clearMemberCookie();
  redirect("/");
}

export async function renameAction(fd: FormData) {
  const m = await getMember();
  if (!m) redirect("/login?next=/account");
  if (!(await allow("account", await requestIp()))) redirect(`/account?err=${enc(BUSY)}`);
  let r;
  try { r = await renameMember(m!.id, text(fd, "nickname")); } catch { r = { ok: false as const, message: "変更できませんでした。時間をおいて再度お試しください。" }; }
  redirect(r.ok ? "/account?done=nickname" : `/account?err=${enc(r.message)}`);
}

export async function changePasswordAction(fd: FormData) {
  const m = await getMember();
  if (!m) redirect("/login?next=/account");
  const back = (q: string): never => redirect(`/account?${q}`);
  if (!(await allow("account", await requestIp()))) back(`err=${enc(BUSY)}`);
  if (text(fd, "next") !== text(fd, "next2")) back(`err=${enc("新しいパスワードが一致しません。")}`);
  let r;
  try { r = await changeMemberPassword(m!.id, text(fd, "current"), text(fd, "next")); } catch { r = { ok: false as const, message: "変更できませんでした。時間をおいて再度お試しください。" }; }
  if (!r.ok || !r.passwordHash) back(`err=${enc(r.ok ? "変更できませんでした。" : r.message)}`);
  // 変更後は、すべての端末のログインが無効になるため、この端末だけ新しいセッションを発行し直す。
  await setMemberCookie((await createMemberSession(m!.id, r.passwordHash!)).token);
  back("done=password");
}
