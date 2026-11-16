import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { isStampSport } from "@/lib/domain/stamps";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { tapBySport, verifyTag } from "@/lib/repo/stamps";

export const dynamic = "force-dynamic";

// 会場のNFCタグ(またはQR)のURL。タグは競技ごとに1枚で、毎回同じものを使う(バドミントン用・バレーボール用)。
// ログイン中の参加者が開くと、その人が参加確定で申し込んでいる、いま開催中のイベントのスタンプが付く(1イベント1回)。
// 未ログインなら、ログイン(登録)のあとに、このURLへ戻って付与する。結果は /stamp の案内として出す。
// 付与はトランザクションで、二重に付かない。URLの署名(競技+版)が合わなければ何もしない。
export async function GET(_req: Request, ctx: { params: Promise<{ sport: string; token: string }> }) {
  const { sport, token } = await ctx.params;
  const here = `/stamp/t/${sport}/${token}`;
  let to: string;
  try {
    if (!isStampSport(sport)) { to = "/stamp?tap=bad"; }
    else if (!(await allow("stamp", await requestIp()))) { to = "/stamp?tap=busy"; }
    else if (!(await verifyTag(sport, token))) { to = "/stamp?tap=bad"; }
    else {
      const member = await getMember();
      if (!member) { to = `/login?next=${encodeURIComponent(here)}`; }
      else {
        const r = await tapBySport(member.id, sport, token);
        to = `/stamp?tap=${r.result}&sport=${sport}`;
      }
    }
  } catch { to = "/stamp?tap=retry"; } // 読み取りの失敗など。ポイントは付けず、もう一度かざしてもらう
  redirect(to);
}
