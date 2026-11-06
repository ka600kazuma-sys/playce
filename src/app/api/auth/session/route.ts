import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { isAllowedAdmin, isSameOrigin } from "@/lib/auth/allowlist";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, allowlist } from "@/lib/auth/session";

const secure = process.env.NODE_ENV === "production";
const deny = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!isSameOrigin(req.headers.get("origin"), req.headers.get("host"))) return deny(403, "forbidden");
  if (!(await allow("login", await requestIp(req.headers)))) return deny(429, "too many requests");
  let idToken: unknown;
  try { idToken = (await req.json())?.idToken; } catch { return deny(400, "bad request"); }
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 4096) return deny(400, "bad request");
  try {
    const auth = adminAuth();
    const decoded = await auth.verifyIdToken(idToken, true);
    // 直近5分以内にログインした場合だけセッションを発行する
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) return deny(401, "unauthorized");
    // 許可リスト外には理由を伝えない(許可リストの有無を推測させない)
    if (!isAllowedAdmin(decoded, allowlist())) return deny(403, "forbidden");
    const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
    const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, cookie, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: SESSION_MAX_AGE_MS / 1000 });
    return res;
  } catch {
    return deny(401, "unauthorized");
  }
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req.headers.get("origin"), req.headers.get("host"))) return deny(403, "forbidden");
  const value = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (value) {
    try {
      const auth = adminAuth();
      const decoded = await auth.verifySessionCookie(value);
      await auth.revokeRefreshTokens(decoded.uid); // 他の端末のセッションも失効させる
    } catch { /* 検証できない Cookie は削除だけ行う */ }
  }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
