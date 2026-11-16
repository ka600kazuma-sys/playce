import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { tap, verifyTag } from "@/lib/repo/stamps";

export const dynamic = "force-dynamic";

// 会場のNFCタグ(またはQR)のURL。ログイン中の参加者が開くと、そのイベントのスタンプが付く(1イベント1回)。
// 未ログインなら、ログイン(登録)のあとに、このURLへ戻って付与する。結果は /stamp の案内として出す。
// 付与はトランザクションで、二重に付かない。URLの署名(版つき)が合わなければ何もしない。
export async function GET(_req: Request, ctx: { params: Promise<{ eventId: string; token: string }> }) {
  const { eventId, token } = await ctx.params;
  const here = `/stamp/t/${eventId}/${token}`;
  let to: string;
  try {
    if (!(await allow("stamp", await requestIp()))) { to = "/stamp?tap=invalid"; }
    else if (!(await verifyTag(eventId, token))) { to = "/stamp?tap=bad"; }
    else {
      const member = await getMember();
      if (!member) { to = `/login?next=${encodeURIComponent(here)}`; }
      else {
        const r = await tap(member.id, eventId, token);
        to = `/stamp?tap=${r.result}${r.sport ? `&sport=${r.sport}` : ""}`;
      }
    }
  } catch { to = "/stamp?tap=invalid"; }
  redirect(to);
}
