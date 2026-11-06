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
// ホスティング(App Hosting / Cloud Run)のプロキシ配下では Host が内部のホスト名になるため、
// プロキシが付ける X-Forwarded-Host(公開ドメイン)も照合する。別サイトのページからのリクエストは、
// X-Forwarded-Host を任意に設定できない(ブラウザが許さない)ため、この照合で CSRF 対策は弱まらない。
export function isSameOrigin(origin: string | null, host: string | null, forwardedHost?: string | null): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin).host;
    const fwd = forwardedHost?.split(",")[0]?.trim();
    return (!!host && o === host) || (!!fwd && o === fwd);
  } catch {
    return false;
  }
}

export const sameOriginOf = (h: Headers) => isSameOrigin(h.get("origin"), h.get("host"), h.get("x-forwarded-host"));
