import "server-only";
import { db } from "@/lib/firebase/admin";
import { hashSecret, isTokenShape, newToken } from "@/lib/domain/registration";

// 主催者のログインセッション。Cookieにはトークン、DBにはそのハッシュだけを保存する。
// 有効期限つき。パスワードを変えると(pwv が変わると)すべて無効になる。
export const SESSION_MS = 8 * 60 * 60 * 1000;
const col = () => db().collection("adminSessions");

export async function createSession(pwv: string): Promise<{ token: string }> {
  const { token, hash } = newToken();
  const now = Date.now();
  await col().doc(hash).create({ createdAt: now, expiresAt: now + SESSION_MS, expireAt: new Date(now + SESSION_MS + 24 * 3600e3), pwv });
  return { token };
}

export async function isValidSession(token: string, pwv: string): Promise<boolean> {
  if (!isTokenShape(token)) return false;
  const ref = col().doc(hashSecret(token));
  const s = await ref.get();
  if (!s.exists) return false;
  const d = s.data() as { expiresAt: number; pwv: string };
  if (d.expiresAt <= Date.now() || d.pwv !== pwv) { await ref.delete().catch(() => {}); return false; }
  return true;
}

export async function deleteSession(token: string): Promise<void> {
  if (isTokenShape(token)) await col().doc(hashSecret(token)).delete();
}
