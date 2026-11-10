import { NextResponse } from "next/server";
import { sameOriginOf } from "@/lib/auth/allowlist";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { deleteSession } from "@/lib/repo/adminSessions";

const secure = process.env.NODE_ENV === "production";
const deny = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

// Googleログインは廃止(パスワードログインに変更)。ログアウトだけ残す。
export async function POST() {
  return deny(410, "gone");
}

// ログアウト: サーバー側のセッションを削除し、Cookie も消す。
export async function DELETE(req: Request) {
  if (!sameOriginOf(req.headers)) return deny(403, "forbidden");
  const value = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (value) { try { await deleteSession(value); } catch { /* 消せなくても Cookie は削除する */ } }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
