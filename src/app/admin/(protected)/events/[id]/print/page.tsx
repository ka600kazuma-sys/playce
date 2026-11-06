import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getEventAny } from "@/lib/repo/adminEvents";
import { listRegs } from "@/lib/repo/reception";
import { amountDue, balance } from "@/lib/domain/reception";
import { dateText, timeText } from "@/lib/format";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "受付名簿 | PLAYCE 管理", robots: { index: false, follow: false } };

// 受付チェック欄つきの印刷用名簿(主催者のみ)。個別管理URL・トークン・ブラウザ識別は含めない。
export default async function PrintRoster({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  let e, regs;
  try { [e, regs] = await Promise.all([getEventAny(id), listRegs(id)]); }
  catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e) notFound();
  const rows = regs.filter((r) => r.status === "confirmed" || r.status === "offered");
  const total = rows.reduce((n, r) => n + r.partySize, 0);
  return (
    <main className="space-y-3">
      <div className="space-y-2 print:hidden">
        <Link href={`/admin/events/${id}`} className="text-sm">← イベント編集</Link>
        <PrintButton />
        <p className="text-xs text-gray-500">印刷ダイアログで「PDFとして保存」も選べます。この名簿には参加者のニックネームが含まれます。取り扱いにご注意ください。</p>
      </div>
      <h1 className="text-xl font-bold">{e.title} 受付名簿</h1>
      <p className="text-sm">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)} / {e.venue} / {rows.length}件・{total}人</p>
      <table className="w-full border-collapse text-sm">
        <thead><tr>{["No.", "代表者(同行者)", "人数", "受付", "支払", "料金", "備考"].map((h) => <th key={h} className="border border-gray-500 p-2 text-left">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="break-inside-avoid">
              <td className="border border-gray-500 p-2">{i + 1}</td>
              <td className="border border-gray-500 p-2">{r.nickname}{r.members.length > 0 && <span className="block text-xs text-gray-600">{r.members.join("、")}</span>}</td>
              <td className="border border-gray-500 p-2">{r.partySize}</td>
              <td className="w-12 border border-gray-500 p-2 text-center text-xl">{r.checkedIn ? "済" : "☐"}</td>
              <td className="w-12 border border-gray-500 p-2 text-center text-xl">{balance(r) <= 0 && amountDue(r) > 0 ? "済" : "☐"}</td>
              <td className="border border-gray-500 p-2">{amountDue(r).toLocaleString()}円</td>
              <td className="border border-gray-500 p-2 text-xs">{[r.source === "walkin" ? "飛び入り" : "", r.status === "offered" ? "繰上げ確認中" : "", r.reconfirm ? "日程の継続確認待ち" : ""].filter(Boolean).join(" / ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-sm text-gray-500">受付対象の申込がありません。</p>}
    </main>
  );
}
