import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { makePending } from "@/lib/domain/receptionqr";
import { formSecret } from "@/lib/repo/formtoken";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { peekToken, scanReception } from "@/lib/repo/receptionqr";

export const dynamic = "force-dynamic";

// ふりたの受付QR。スマホのカメラ・ブラウザで開く(アプリのインストール不要)。
// ログイン済み: そのまま受付。未ログイン: QRがいま有効かを確かめ、読み取りの記録(署名つき・15分・Cookie)を残して、ログイン/新規登録へ。
// 登録に時間がかかってQRが切り替わっても、読み取った時点のQRとして受付を続けられる(/r/resume)。検証・受付・当日参加の登録は、すべてサーバー側。結果は /r/result に出す。
export async function GET(_req: Request, ctx: { params: Promise<{ eventId: string; token: string }> }) {
  const { eventId, token } = await ctx.params;
  let to: string;
  const now = Date.now(); // 検証と保留の署名で、同じ時刻を使う
  try {
    if (!(await allow("stamp", await requestIp()))) to = "/r/result?r=busy";
    else {
      const member = await getMember();
      if (member) {
        const r = await scanReception(member.id, eventId, token);
        to = `/r/result?r=${r.result}${r.multiplier && r.multiplier > 1 ? `&m=${r.multiplier}` : ""}`;
      } else {
        const chk = await peekToken(eventId, token, now);
        const secret = formSecret();
        if (chk !== "ok" || !secret) to = `/r/result?r=${chk === "ok" ? "retry" : chk}`;
        else {
          (await cookies()).set("rq_pend", makePending(secret, eventId, token, now), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/r", maxAge: 15 * 60 });
          to = `/login?next=${encodeURIComponent("/r/resume")}`;
        }
      }
    }
  } catch { to = "/r/result?r=retry"; }
  redirect(to);
}
