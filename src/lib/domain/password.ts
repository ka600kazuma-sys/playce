import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// 主催者のパスワード。保存するのはパスワードそのものではなく、scrypt で計算したハッシュ(Secret Manager の ADMIN_PASSWORD_HASH)。
// 形式: scrypt$N$r$p$salt$hash(salt・hash は base64url)
const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const MIN_LENGTH = 14, MAX_LENGTH = 200;

const norm = (s: string) => s.normalize("NFKC"); // 全角・半角の入力方式の違いで、一致しなくなるのを防ぐ
const kdf = (pw: string, salt: Buffer, n: number, r: number, p: number, len: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(norm(pw), salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));

// パスワードとして弱すぎるものを弾く(長さと、同じ文字の繰り返し)。
export function passwordProblem(pw: string): string | null {
  const t = norm(pw);
  if (t.length < MIN_LENGTH) return `${MIN_LENGTH}文字以上にしてください(長い文章・単語をつないだものがおすすめです)`;
  if (t.length > MAX_LENGTH) return `${MAX_LENGTH}文字以内にしてください`;
  if (new Set(t).size < 6) return "同じ文字の繰り返しは使えません";
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await kdf(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// 形式が不正・空のときは常に false。比較は一定時間で行う。
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || pw.length === 0 || pw.length > MAX_LENGTH * 2) return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every(Number.isInteger) || n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  try {
    const salt = Buffer.from(parts[4], "base64url"), want = Buffer.from(parts[5], "base64url");
    if (salt.length < 8 || want.length < 16) return false;
    const got = await kdf(pw, salt, n, r, p, want.length);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// パスワードを変える(ハッシュが変わる)と、発行済みのセッションをすべて無効にするための識別子。
export const fingerprint = (stored: string) => createHash("sha256").update(stored.trim()).digest("hex").slice(0, 16);
