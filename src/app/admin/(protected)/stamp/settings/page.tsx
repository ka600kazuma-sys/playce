import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getStampSettings } from "@/lib/repo/stampadmin";
import type { Reward } from "@/lib/domain/stampcard2";
import { saveSettingsAction } from "../members/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "特典内容の設定 | PLAYCE 管理", robots: { index: false, follow: false } };

function RewardInput({ k, label, r }: { k: string; label: string; r: Reward }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm"><span className="w-40">{label}</span>
      <select name={`${k}_kind`} defaultValue={r.kind} className="rounded border p-2"><option value="discount">割引</option><option value="free">参加費1回無料</option></select>
      <input type="number" name={`${k}_yen`} min={0} max={100000} defaultValue={r.kind === "discount" ? r.yen : 0} className="w-28 rounded border p-2" aria-label={`${label}の割引額`} />円
    </div>
  );
}
export default async function StampSettings({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { rewards: w, policy } = await getStampSettings();
  return (
    <main className="space-y-4">
      <Link href="/admin/stamp" className="text-sm">← スタンプカード</Link>
      <h1 className="text-xl font-bold">特典内容・クーポンの設定</h1>
      {sp.ok && <p className="rounded border p-3 text-sm">保存しました(履歴に残ります)。すでに発行したクーポンは変わりません。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">保存できませんでした。入力を確認してください。</p>}
      <form action={saveSettingsAction} className="space-y-3 rounded border p-3">
        <p className="text-sm font-semibold">奇数周(1・3・5周目)</p>
        <RewardInput k="odd3" label="3ポイント到達" r={w.odd[3]} /><RewardInput k="odd5" label="5ポイント到達" r={w.odd[5]} />
        <p className="text-sm font-semibold">偶数周(2・4・6周目)</p>
        <RewardInput k="even3" label="3ポイント到達" r={w.even[3]} /><RewardInput k="even5" label="5ポイント到達" r={w.even[5]} />
        <hr />
        <p className="text-sm font-semibold">クーポンの運用(未確定事項。ここで切り替えます)</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sameDay" defaultChecked={policy.sameDay} className="h-5 w-5" /> 発行されたイベントの当日から使える(オフ=次回以降)</label>
        <label className="block text-sm">有効日数(空欄=期限なし)<input type="number" name="expiryDays" min={1} max={3650} defaultValue={policy.expiryDays ?? ""} className="ml-2 w-28 rounded border p-2" />日</label>
        <p className="text-xs text-gray-500">併用(1回の参加で複数枚)は現在できません(1申込1枚)。無料券使用時のポイント付与は、保留(付与しない)です。</p>
        <button className="w-full rounded bg-black p-3 font-semibold text-white">保存する</button>
      </form>
    </main>
  );
}
