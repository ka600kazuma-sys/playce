import { createHash, randomBytes } from "node:crypto";

// 参加者のアカウント(ニックネーム+自分で決めたパスワード)。
export const NICK_MAX = 20;
export const PW_MIN = 8, PW_MAX = 100;

export const normalizeNickname = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

// ニックネームの検証。公開の参加者一覧にも出るため、記号・制御文字・長すぎるものは弾く。
export function nicknameProblem(raw: string): string | null {
  const n = normalizeNickname(raw);
  if (n.length === 0) return "ニックネームを入力してください";
  if (n.length > NICK_MAX) return `ニックネームは${NICK_MAX}文字以内で入力してください`;
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(n)) return "ニックネームに使えない文字が含まれています";
  return null;
}

// ログインの識別に使うため、大文字小文字・全角半角の違いは同じニックネームとして扱う(重複登録を防ぐ)。
export const nicknameKey = (raw: string) => createHash("sha256").update(normalizeNickname(raw).toLowerCase()).digest("hex");

export function memberPasswordProblem(pw: string, nickname?: string): string | null {
  const t = pw.normalize("NFKC");
  if (t.length < PW_MIN) return `パスワードは${PW_MIN}文字以上にしてください`;
  if (t.length > PW_MAX) return `パスワードは${PW_MAX}文字以内にしてください`;
  if (new Set(t).size < 4) return "同じ文字の繰り返しは使えません";
  if (nickname && t.toLowerCase() === normalizeNickname(nickname).toLowerCase()) return "ニックネームと同じパスワードは使えません";
  return null;
}

// 安全なリダイレクト先(同じサイト内の相対パスだけ)。
export const safeNext = (n: unknown, fallback = "/") => (typeof n === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) && !n.includes("..") ? n : fallback);

// ---- アカウントの引き継ぎコード(機種変更用)----
// 12文字(32種類 = 60ビット)の暗号乱数。紛らわしい文字(I, O, 0, 1)は使わない。DBにはハッシュだけを保存する。
export const TRANSFER_TTL_MS = 30 * 60 * 1000; // 有効期限: 30分
export const TRANSFER_MAX_USES = 1;            // 使用回数: 1回
const TRANSFER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32文字なので、バイト値の剰余に偏りが出ない
const TRANSFER_LEN = 12;

export const normalizeTransferCode = (raw: string) => raw.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
export const transferCodeShape = (norm: string) => new RegExp(`^[${TRANSFER_ALPHABET}]{${TRANSFER_LEN}}$`).test(norm);
export const transferCodeHash = (raw: string) => createHash("sha256").update(`transfer|${normalizeTransferCode(raw)}`).digest("hex");
export const formatTransferCode = (norm: string) => norm.match(/.{1,4}/g)!.join("-");

export function newTransferCode(): { code: string; hash: string } {
  const bytes = randomBytes(TRANSFER_LEN);
  let norm = ""; for (const b of bytes) norm += TRANSFER_ALPHABET[b % 32];
  return { code: formatTransferCode(norm), hash: transferCodeHash(norm) };
}
