"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MEMBER_COOKIE, clearMemberCookie, getMember, setMemberCookie } from "@/lib/auth/member";
import { nicknameKey, safeNext } from "@/lib/domain/member";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { authenticateMember, changeMemberPassword, createMember, createMemberSession, deleteMemberSession, getMemberPasswordHash, sessionHasPwv, issueTransferCode, redeemTransferCode, renameMember, setMemberPassword } from "@/lib/repo/members";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 初回登録: ニックネーム+パスワード。登録後は、長期のセッションCookieで自動ログインする。
// パスワードは、Safari(タグ・QRの遷移先)や、サイトデータを消したあとのログイン用。この端末のセッションは、パスワードの版に縛らない(変更しても追い出されない)。
export async function signupAction(fd: FormData) {
  const next = safeNext(text(fd, "next"));
  const fail = (m: string): never => redirect(`/signup?err=${enc(m)}&next=${enc(next)}`);
  if (text(fd, "website") !== "") fail("登録できませんでした。");
  if (!(await allow("signup", await requestIp()))) fail(BUSY);
  if (text(fd, "password") !== text(fd, "again")) fail("パスワードの確認入力が一致しません。");
  let r;
  try { r = await createMember(text(fd, "nickname"), text(fd, "password"), "self"); } catch { return fail("登録できませんでした。時間をおいて再度お試しください。"); }
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

// パスワードの設定・変更(Safariなど、別の画面でログインするとき用)。未設定なら新規設定、設定済みなら現在のパスワードの確認が必要。
// 設定後、パスワードで入っていた端末だけ新しいセッションに入れ替える。ニックネームだけで入った端末(アプリ)は、そのまま有効。
export async function setPasswordAction(fd: FormData) {
  const m = await getMember();
  if (!m) redirect("/login?next=/account");
  const fail = (msg: string): never => redirect(`/account?err=${enc(msg)}`);
  if (!(await allow("account", await requestIp())) || !(await allow("pwset", m!.id))) fail(BUSY);
  const next = text(fd, "password"), again = text(fd, "again"), current = text(fd, "current");
  if (next !== again) fail("確認用の入力が一致しません。");
  let r;
  try {
    const has = await getMemberPasswordHash(m!.id);
    if (has) { await sleep(500); r = await changeMemberPassword(m!.id, current, next); }
    else r = await setMemberPassword(m!.id, next, null);
  } catch { r = { ok: false as const, message: "設定できませんでした。時間をおいて再度お試しください。" }; }
  if (!r.ok || !r.passwordHash) return fail(r.ok ? "設定できませんでした。" : r.message);
  // パスワードで入っていた端末だけ、新しい版のセッションに入れ替える。ニックネームだけで入った端末(ホーム画面のアプリ)は、そのまま。
  const cur = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (cur && (await sessionHasPwv(cur).catch(() => false))) {
    await setMemberCookie((await createMemberSession(m!.id, r.passwordHash)).token);
    await deleteMemberSession(cur).catch(() => {});
  }
  redirect("/account?done=password");
}
