import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fingerprint } from "@/lib/domain/password";
import { isValidSession } from "@/lib/repo/adminSessions";

export const SESSION_COOKIE = "playce_admin";
export { SESSION_MS as SESSION_MAX_AGE_MS } from "@/lib/repo/adminSessions";

// 主催者のパスワードのハッシュ(Secret Manager)。未設定なら、誰もログインできない。
export const adminPasswordHash = () => process.env.ADMIN_PASSWORD_HASH ?? "";
// 操作の記録に残す呼び名(ADMIN_EMAILS の先頭。なければ「管理者」)。
const label = () => (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] ?? "管理者";

// Cookie のセッションを、有効期限とパスワードの版まで含めて検証する。主催者でなければ null。
export async function getAdmin() {
  const hash = adminPasswordHash();
  if (!hash) return null;
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    return (await isValidSession(value, fingerprint(hash))) ? { uid: "owner", email: label() } : null;
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
