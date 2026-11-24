import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { isQrCount } from "@/lib/domain/stamps";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { tapQr } from "@/lib/repo/stamps";

export const dynamic = "force-dynamic";

// 付け忘れ用のQR(1個・2個)のURL。主催者の画面に出したQRを、参加者がアプリ内のカメラ(またはスマホのカメラ)で読む。
// ログイン中の参加者だけ。未ログインなら、ログインのあとに、このURLへ戻って付与する。結果は /stamp の案内として出す。
// 付与はトランザクションで、1イベント1回。署名(イベント+個数)が合わなければ何もしない。
export async function GET(_req: Request, ctx: { params: Promise<{ eventId: string; count: string; token: string }> }) {
  const { eventId, count, token } = await ctx.params;
  const n = Number(count);
  const here = `/stamp/q/${eventId}/${count}/${token}`;
  let to: string;
  try {
    if (!isQrCount(n)) { to = "/stamp?tap=bad"; }
    else if (!(await allow("stamp", await requestIp()))) { to = "/stamp?tap=busy"; }
    else {
      const member = await getMember();
      if (!member) { to = `/login?next=${encodeURIComponent(here)}`; }
      else {
        const r = await tapQr(member.id, eventId, n, token);
        to = `/stamp?tap=${r.result}${r.sport ? `&sport=${r.sport}` : ""}${r.result === "ok" && r.count ? `&n=${r.count}` : ""}`;
      }
    }
  } catch { to = "/stamp?tap=retry"; }
  redirect(to);
}
