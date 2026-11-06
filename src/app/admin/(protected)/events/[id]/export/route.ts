import { getAdmin } from "@/lib/auth/session";
import { listRegs } from "@/lib/repo/reception";
import { amountDue, csvCell } from "@/lib/domain/reception";

// 主催者のみ。個別管理URL・トークン(ドキュメントID)・ブラウザ識別は出力しない。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  let regs;
  try { regs = await listRegs(id); } catch { return new Response("error", { status: 500 }); }
  const head = ["代表者", "同行者", "人数", "状態", "料金(円/人)", "予定額", "入金額", "受付", "区分", "受付済みチェック"];
  const rows = regs.filter((r) => r.status !== "cancelled" && r.status !== "expired").map((r) => [
    r.nickname, r.members.join(" / "), r.partySize, r.status, r.feeYen, amountDue(r), r.paidYen, r.checkedIn ? "済" : "", r.source === "walkin" ? "飛び入り" : "", "☐",
  ]);
  const body = "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="registrations.csv"', "Cache-Control": "no-store" } });
}
