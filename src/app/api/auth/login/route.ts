import { NextResponse } from "next/server";
import { sameOriginOf } from "@/lib/auth/allowlist";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, adminPasswordHash } from "@/lib/auth/session";
import { fingerprint, verifyPassword } from "@/lib/domain/password";
import { createSession } from "@/lib/repo/adminSessions";

const secure = process.env.NODE_ENV === "production";
const deny = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

// 主催者のパスワードログイン。同一オリジンのみ・IPごとの回数制限・失敗時の待ち時間つき。理由(どちらが違うか等)は区別して伝えない。
export async function POST(req: Request) {
  if (!sameOriginOf(req.headers)) return deny(403, "forbidden");
  if (!(await allow("login", await requestIp(req.headers)))) return deny(429, "試行回数が多すぎます。10分ほど待ってからお試しください。");
  const hash = adminPasswordHash();
  if (!hash) return deny(503, "ログインの準備ができていません。");
  let password: unknown;
  try { password = (await req.json())?.password; } catch { return deny(400, "bad request"); }
  if (typeof password !== "string" || password.length === 0 || password.length > 400) return deny(400, "bad request");
  if (!(await verifyPassword(password, hash))) {
    await new Promise((r) => setTimeout(r, 1000)); // 総当たりを遅くする
    return deny(401, "パスワードが違います。");
  }
  const { token } = await createSession(fingerprint(hash));
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: SESSION_MAX_AGE_MS / 1000 });
  return res;
}
