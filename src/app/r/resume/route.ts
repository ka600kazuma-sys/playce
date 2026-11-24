import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { parsePending } from "@/lib/domain/receptionqr";
import { formSecret } from "@/lib/repo/formtoken";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { scanReception } from "@/lib/repo/receptionqr";

export const dynamic = "force-dynamic";

// ログイン/新規登録のあとに戻る先。読み取り時に残した記録(署名つき・15分以内)があれば、その時刻のQRとして受付を続ける。1回使うと消える。
export async function GET() {
  let to: string;
  try {
    const jar = await cookies();
    const raw = jar.get("rq_pend")?.value ?? "";
    const member = await getMember();
    if (!member) to = raw ? `/login?next=${encodeURIComponent("/r/resume")}` : "/r/result?r=bad";
    else if (!(await allow("stamp", await requestIp()))) to = "/r/result?r=busy";
    else {
      const p = parsePending(formSecret(), raw, Date.now());
      if (!p) { jar.delete({ name: "rq_pend", path: "/r" }); to = "/r/result?r=expired"; }
      else {
        const r = await scanReception(member.id, p.eventId, p.token, p.ts);
        jar.delete({ name: "rq_pend", path: "/r" }); // 受付の結果が出てから消す(一時的なエラーのときは、期限内なら開き直して再試行できる)
        to = `/r/result?r=${r.result}${r.multiplier && r.multiplier > 1 ? `&m=${r.multiplier}` : ""}`;
      }
    }
  } catch { to = "/r/result?r=retry"; }
  redirect(to);
}
