// 会場名からGoogleマップへのリンクを決める(画面・保存に依存しない純粋関数)。
// 会場は、イベントの「場所」(自由な文字列)。リンクは次の順で決まる:
//   1. 主催者が管理画面で登録した地図のURL(会場名が一致したとき)
//   2. 登録がなければ、会場名でのGoogleマップ検索(どの会場でも、追加の作業なしで、押せる)
// 会場名の一致は、全角半角・大文字小文字・空白の違いを無視する。

export const VENUE_NAME_MAX = 100;
export const MAP_URL_MAX = 500;

export const venueKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export const searchUrl = (name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name.normalize("NFKC").trim())}`;

// 地図のURLとして登録できるのは、https の Googleマップ(共有リンク・短縮リンクを含む)だけ。
// 任意のサイトや javascript: などへ誘導できないようにする。
const GOOGLE_HOSTS = new Set(["www.google.com", "google.com", "www.google.co.jp", "google.co.jp"]);
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "maps.google.com"]);
export function mapUrlProblem(input: string): string | null {
  const s = input.trim();
  if (s.length === 0) return "地図のURLを入力してください";
  if (s.length > MAP_URL_MAX) return `地図のURLが長すぎます(${MAP_URL_MAX}文字まで)`;
  let u: URL;
  try { u = new URL(s); } catch { return "URLの形式が正しくありません"; }
  if (u.protocol !== "https:") return "https で始まるURLを入力してください";
  if (u.username || u.password) return "このURLは使えません";
  const host = u.hostname.toLowerCase();
  const ok = SHORT_HOSTS.has(host) || (GOOGLE_HOSTS.has(host) && (u.pathname === "/maps" || u.pathname.startsWith("/maps/"))) || (host === "goo.gl" && (u.pathname === "/maps" || u.pathname.startsWith("/maps/")));
  return ok ? null : "Googleマップのリンク(共有→リンクをコピー)を入力してください";
}

export function venueNameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return "会場名を入力してください";
  if (n.length > VENUE_NAME_MAX) return `会場名が長すぎます(${VENUE_NAME_MAX}文字まで)`;
  return null;
}

// registry: 会場名のキー → 登録済みの地図URL
export function venueHref(name: string, registry: Record<string, string>): { href: string; registered: boolean } {
  const key = venueKey(name);
  // 自分のキーだけを見る(会場名が constructor・__proto__ などでも、継承されたものを拾わない)。文字列で、検証を通るものだけ使う。
  const url = Object.hasOwn(registry, key) ? registry[key] : undefined;
  return typeof url === "string" && mapUrlProblem(url) === null ? { href: url, registered: true } : { href: searchUrl(name), registered: false };
}
