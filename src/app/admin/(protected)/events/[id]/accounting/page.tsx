import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getEventAny } from "@/lib/repo/adminEvents";
import { listPayments, listRegs } from "@/lib/repo/reception";
import { getAccounting, listExpenses } from "@/lib/repo/accounting";
import { EXPENSE_CATEGORIES, summarize } from "@/lib/domain/accounting";
import { totals } from "@/lib/domain/reception";
import { dateText, timeText } from "@/lib/format";
import { addExpenseAction, closeAction, reopenAction, voidExpenseAction } from "./actions";

export const dynamic = "force-dynamic";
const yen = (n: number) => `${n.toLocaleString()}円`;
const at = (ms: number) => `${dateText(new Date(ms).toISOString())} ${timeText(new Date(ms).toISOString())}`;

export default async function Accounting({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  let e, regs, pays, exps, state;
  try { [e, regs, pays, exps, state] = await Promise.all([getEventAny(id), listRegs(id), listPayments(id), listExpenses(id), getAccounting(id)]); }
  catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e) notFound();
  const sum = summarize(pays, exps);
  const planned = totals(regs.map((r) => ({ ...r, counts: r.status === "confirmed" }))).expected;
  const ended = new Date(e.endAt) <= new Date();
  const key = crypto.randomUUID().replaceAll("-", "");

  return (
    <main className="space-y-4">
      <Link href={`/admin/events/${id}`} className="text-sm">← イベント編集</Link>
      <h1 className="text-xl font-bold">会計: {e.title}</h1>
      {sp.ok && <p className="rounded border p-3 text-sm">記録しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      {state.closed && <p className="rounded border border-blue-400 p-3 text-sm">会計は確定済みです（{state.closedAt && at(state.closedAt)} / {state.closedBy}）。変更するには確定を解除してください。</p>}

      <section className="space-y-1 rounded border p-3 text-sm">
        <div>予定額（申込時の料金×人数）: {yen(planned)}</div>
        <div>売上（入金実績）: <strong>{yen(sum.revenue)}</strong></div>
        <div>経費: <strong>{yen(sum.expenses)}</strong></div>
        <div className={sum.profit < 0 ? "font-bold text-red-700" : "font-bold"}>利益: {yen(sum.profit)}{sum.profit < 0 && "（赤字）"}</div>
        {Object.entries(sum.byCategory).map(([c, n]) => <div key={c} className="text-xs text-gray-600">・{c}: {yen(n)}</div>)}
      </section>

      {!state.closed && (
        <form action={addExpenseAction.bind(null, id)} className="space-y-2 rounded border p-3">
          <p className="text-sm font-semibold">経費を追加</p>
          <input type="hidden" name="key" value={key} />
          <select name="category" className="w-full rounded border p-3 text-base">{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input name="description" required maxLength={100} placeholder="内容（例: 体育館使用料）" className="w-full rounded border p-3 text-base" />
          <input type="number" name="amount" required min={1} max={10000000} placeholder="金額（円）" className="w-full rounded border p-3 text-base" />
          <button className="w-full rounded border p-3">追加する</button>
        </form>
      )}

      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-semibold">経費</h2>
        {exps.length === 0 && <p className="text-gray-500">経費はまだありません。</p>}
        <ul className="space-y-2">{exps.map((x) => (
          <li key={x.id} className={x.voided ? "text-gray-400 line-through" : ""}>
            <div>{at(x.at)} / {x.category} / {x.description} / {yen(x.amountYen)} / {x.by}</div>
            {x.voided ? <div className="no-underline">取消済み: {x.voidReason}</div> : !state.closed && (
              <form action={voidExpenseAction.bind(null, id, x.id)} className="mt-1 flex gap-1">
                <input name="reason" required maxLength={200} placeholder="取消の理由" className="flex-1 rounded border p-2" />
                <button className="rounded border px-3 py-2">取り消す</button>
              </form>
            )}
          </li>
        ))}</ul>
      </section>

      <section className="space-y-2 rounded border p-3 text-sm">
        <h2 className="font-semibold">会計の確定</h2>
        {state.closed ? (
          <form action={reopenAction.bind(null, id)} className="flex gap-1">
            <input name="reason" required maxLength={200} placeholder="解除の理由（履歴に残ります）" className="flex-1 rounded border p-2" />
            <button className="rounded border px-3 py-2">確定を解除</button>
          </form>
        ) : (
          <form action={closeAction.bind(null, id)}>
            <button disabled={!ended} className="w-full rounded bg-black p-3 font-semibold text-white disabled:opacity-40">この内容で会計を確定する</button>
            {!ended && <p className="mt-1 text-xs text-gray-500">イベント終了後に確定できます。</p>}
          </form>
        )}
        {state.history.length > 0 && <ul className="text-xs text-gray-600">{state.history.map((h, i) => <li key={i}>{at(h.at)} / {h.by} / {h.action === "close" ? "確定" : `解除（${h.reason}）`}</li>)}</ul>}
      </section>
    </main>
  );
}
