import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberBySession, MEMBER_SESSION_MS, type MemberView } from "@/lib/repo/members";

export const MEMBER_COOKIE = "playce_member";
const isProd = process.env.NODE_ENV === "production";

// ログイン中の参加者(メンバー)。Cookie のセッションを、有効期限とパスワードの版まで含めて検証する。未ログインなら null。
export async function getMember(): Promise<MemberView | null> {
  const value = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (!value) return null;
  try { return await getMemberBySession(value); } catch { return null; }
}

// ログインが必要な画面・操作の入口。未ログインなら、ログイン後に元の画面へ戻れるよう next を付けて、ログイン画面へ移す。
export async function requireMember(next: string): Promise<MemberView> {
  const m = await getMember();
  if (!m) redirect(`/login?next=${encodeURIComponent(next)}`);
  return m;
}

// SameSite=Lax: 他のアプリ(LINEなど)のリンクから開いても、ログイン状態が保たれる。管理者の Cookie(Strict)とは別。
export async function setMemberCookie(token: string) {
  (await cookies()).set(MEMBER_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: MEMBER_SESSION_MS / 1000 });
}
export async function clearMemberCookie() { (await cookies()).set(MEMBER_COOKIE, "", { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 0 }); }
