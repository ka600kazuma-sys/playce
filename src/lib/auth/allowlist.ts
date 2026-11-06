// 主催者の許可判定。ログインできること(Googleアカウントであること)と、管理者であることは別。
// 許可リストはコードに書かず、サーバー側の環境変数 ADMIN_EMAILS(カンマ区切り)で与える。
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export type VerifiedIdentity = {
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
};

// 許可リストが空なら全員拒否。メールは確認済みの Google アカウントに限る。
export function isAllowedAdmin(id: VerifiedIdentity, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  if (!id.email || id.email_verified !== true) return false;
  if (id.firebase?.sign_in_provider !== "google.com") return false;
  return allowlist.includes(id.email.toLowerCase());
}

// 状態を変えるリクエストが、自サイトから送られたものか確認する(CSRF対策)。
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
