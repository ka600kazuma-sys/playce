import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "@/lib/firebase/admin";
import { isAllowedAdmin, parseAllowlist } from "./allowlist";

export const SESSION_COOKIE = "playce_admin";
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8時間

export const allowlist = () => parseAllowlist(process.env.ADMIN_EMAILS);

// セッションCookieを失効確認つきで検証し、許可リストにも照合する。管理者でなければ null。
export async function getAdmin() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(value, true);
    return isAllowedAdmin(decoded, allowlist()) ? { uid: decoded.uid, email: decoded.email! } : null;
  } catch {
    return null;
  }
}

// 管理画面・管理用 Server Action の入口で必ず呼ぶ。画面を隠すだけでは保護にならない。
export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
