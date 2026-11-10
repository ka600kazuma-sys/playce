"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MEMBER_COOKIE, clearMemberCookie, getMember, setMemberCookie } from "@/lib/auth/member";
import { nicknameKey, safeNext } from "@/lib/domain/member";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { authenticateMember, createMemberNickOnly, createMemberSession, deleteMemberSession, issueTransferCode, redeemTransferCode, renameMember } from "@/lib/repo/members";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 初回登録: ニックネームだけ。登録後は、長期のセッションCookieで自動ログインする。
export async function signupAction(fd: FormData) {
  const next = safeNext(text(fd, "next"));
  const fail = (m: string): never => redirect(`/signup?err=${enc(m)}&next=${enc(next)}`);
  if (text(fd, "website") !== "") fail("登録できませんでした。");
  if (!(await allow("signup", await requestIp()))) fail(BUSY);
  let r;
  try { r = await createMemberNickOnly(text(fd, "nickname")); } catch { return fail("登録できませんでした。時間をおいて再度お試しください。"); }
  if (!r.ok) fail(r.message);
  await setMemberCookie((await createMemberSession((r as { ok: true; id: string }).id)).token);
  redirect(next);
}

// 引き継ぎコードの発行(旧端末)。コードはURLに載せず、画面にだけ返す。
export type IssueState = { code?: string; expiresAt?: number; error?: string };
export async function issueTransferAction(): Promise<IssueState> {
  const m = await getMember();
  if (!m) return { error: "ログインが必要です" };
  if (!(await allow("transferissue", m.id))) return { error: "発行回数の上限です。しばらくしてからもう一度お試しください。" };
  try { const r = await issueTransferCode(m.id); return r ? { code: r.code, expiresAt: r.expiresAt } : { error: "発行できませんでした" }; } catch { return { error: "発行できませんでした。時間をおいて再度お試しください。" }; }
}

// 引き継ぎコードの入力(新端末)。
export async function redeemTransferAction(fd: FormData) {
  const fail = (m: string): never => redirect(`/restore?err=${enc(m)}`);
  if (text(fd, "website") !== "") fail("引き継ぎできませんでした。");
  if (!(await allow("transfer", await requestIp()))) fail(BUSY);
  await sleep(300);
  let r;
  try { r = await redeemTransferCode(text(fd, "code")); } catch { return fail("引き継ぎできませんでした。時間をおいて再度お試しください。"); }
  if (!r.ok) { await sleep(500); fail("コードが正しくないか、期限切れ・使用済みです。旧端末で新しいコードを発行してください。"); }
  await setMemberCookie((r as { ok: true; token: string }).token);
  redirect("/account?done=restored");
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
