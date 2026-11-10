import { createHash } from "node:crypto";

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
