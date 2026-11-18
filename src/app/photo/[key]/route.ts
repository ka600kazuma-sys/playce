import { allow, requestIp } from "@/lib/repo/ratelimit";
import { getPublicPhoto, PHOTO_KEY_RE } from "@/lib/repo/avatars";

export const dynamic = "force-dynamic";

// 公開の写真(カレンダーの参加者一覧用)。本人が「参加者一覧に写真を表示する」を選んだ人の写真だけが、公開用のキーで取得できる。
// キーはメンバーIDと無関係の乱数で、公開を止める・画像を消す・メンバーを削除すると無効になる(以降は404)。
// 公開していない人・存在しないキーは、同じ404(区別しない)。他のサイトからの埋め込み(CORP)・検索への登録は避ける。
const BASE = { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "X-Robots-Tag": "noindex, noimageindex", "Referrer-Policy": "no-referrer" };
const notFound = () => new Response("Not found", { status: 404, headers: { ...BASE, "Cache-Control": "no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!PHOTO_KEY_RE.test(key)) return notFound();
  if (!(await allow("photo", await requestIp()))) return new Response("Busy", { status: 429, headers: { ...BASE, "Cache-Control": "no-store" } });
  let a: Awaited<ReturnType<typeof getPublicPhoto>> = null;
  try { a = await getPublicPhoto(key); } catch { return new Response("Error", { status: 500, headers: { ...BASE, "Cache-Control": "no-store" } }); }
  if (!a) return notFound();
  // 公開を止めたとき、古い写真が長く残らないよう、短い時間だけキャッシュする。
  return new Response(new Uint8Array(a.data), { headers: { ...BASE, "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Cache-Control": "public, max-age=60" } });
}
