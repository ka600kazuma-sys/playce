import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getEventAny } from "@/lib/repo/adminEvents";
import { listPayments, listRegs } from "@/lib/repo/reception";
import { amountDue, balance, matches, totals } from "@/lib/domain/reception";
import { dateText, timeText } from "@/lib/format";
import { QuickReception } from "./QuickReception";
import { addMemberParticipantAction, checkInAction, feeAction, groupPayAction, listVisibilityAction, payAction, removeParticipantAction, voidAction, walkInAction } from "./actions";
import { listMembers } from "@/lib/repo/members";

export const dynamic = "force-dynamic";
const yen = (n: number) => `${n.toLocaleString()}円`;
const SRC: Record<string, string> = { walkin: "飛び入り", web: "" };

export default async function Reception({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; err?: string; ok?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 50);
  let e, regs, pays;
  const membersAll = await listMembers().catch(() => []);
  try { [e, regs, pays] = await Promise.all([getEventAny(id), listRegs(id), listPayments(id)]); }
  catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!e) notFound();
  const active = regs.filter((r) => r.status === "confirmed");
  const shown = active.filter((r) => matches(q, [r.nickname, ...r.members]));
  const t = totals(regs.map((r) => ({ ...r, counts: r.status === "confirmed" })));
  const checked = active.filter((r) => r.checkedIn);
  const waiting = regs.filter((r) => r.status === "waitlisted" || r.status === "offered").length;
  const groupKey = crypto.randomUUID().replaceAll("-", "");
  const nameOf = (rid: string) => regs.find((r) => r.id === rid)?.nickname ?? "（不明）";

  return (
    <main className="space-y-4">
      <Link href={`/admin/events/${id}`} className="text-sm">← イベント編集</Link>
      <h1 className="text-xl font-bold">当日受付: {e.title}</h1>
      <p className="text-sm text-gray-600">{dateText(e.startAt)} {timeText(e.startAt)}〜{timeText(e.endAt)}</p>
      {sp.ok && <p className="rounded border p-3 text-sm">記録しました。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}

      <section className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded border p-2">受付 {checked.reduce((n, r) => n + r.partySize, 0)} / {active.reduce((n, r) => n + r.partySize, 0)} 人{waiting > 0 && <span>（待ち {waiting} 件）</span>}</div>
        <div className="rounded border p-2">予定額 {yen(t.expected)}<br />入金実績 {yen(t.received)}<br />未収 {yen(t.outstanding)}</div>
      </section>

      <QuickReception eventId={id} regs={active.map((r) => ({ id: r.id, nickname: r.nickname, members: r.members, partySize: r.partySize, checkedIn: r.checkedIn, balance: Math.max(0, balance(r)), reconfirm: r.reconfirm }))} />

      <form className="flex gap-2" action="">
        <input name="q" defaultValue={q} placeholder="ニックネームで検索" className="w-full rounded border p-3 text-base" autoComplete="off" />
        <button className="rounded border px-4">検索</button>
      </form>

      <form id="group" action={groupPayAction.bind(null, id)} className="space-y-2 rounded border p-3">
        <input type="hidden" name="key" value={groupKey} />
        <input type="hidden" name="q" value={q} />
        <p className="text-sm font-semibold">まとめて支払い（チェックした人の残額を受け取る）</p>
        <button className="w-full rounded bg-black p-3 font-semibold text-white">選択した人の残額を受け取る</button>
      </form>

      <ul className="space-y-2">
        {shown.length === 0 && <li className="text-sm text-gray-500">該当する参加者がいません。</li>}
        {shown.map((r) => {
          const bal = balance(r);
          return (
            <li key={r.id} className="space-y-2 rounded border p-3">
              <div className="flex items-start gap-2">
                {bal > 0 && <><input type="checkbox" form="group" name="reg" value={r.id} className="mt-1 h-5 w-5" aria-label={`${r.nickname}をまとめ支払いに含める`} />
                  <input type="hidden" form="group" name={`amount_${r.id}`} value={bal} /></>}
                <div className="flex-1">
                  <div className="font-semibold">{r.nickname} <span className="text-sm font-normal">{r.partySize}人 {SRC[r.source] && `（${SRC[r.source]}）`}</span>{r.reconfirm && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-normal">日程の継続確認待ち</span>}</div>
                  {r.members.length > 0 && <div className="text-xs text-gray-500">同行: {r.members.join("、")}</div>}
                  <div className="text-sm">料金 {yen(r.feeYen)}×{r.partySize} = {yen(amountDue(r))} / 入金 {yen(r.paidYen)} / <strong>{bal > 0 ? `残 ${yen(bal)}` : "支払い済み"}</strong></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={checkInAction.bind(null, id, r.id, !r.checkedIn)}>
                  <input type="hidden" name="q" value={q} />
                  <button className={`rounded border px-4 py-2 ${r.checkedIn ? "bg-green-100" : ""}`}>{r.checkedIn ? "受付済み（取り消す）" : "受付する"}</button>
                </form>
                {bal > 0 && (
                  <form action={payAction.bind(null, id, r.id)} className="flex gap-1">
                    <input type="hidden" name="key" value={`${groupKey.slice(0, 16)}${r.id.slice(0, 16)}`.replace(/[^A-Za-z0-9_-]/g, "")} />
                    <input type="hidden" name="q" value={q} />
                    <input type="number" name="amount" defaultValue={bal} min={1} max={bal} className="w-24 rounded border p-2" aria-label="支払い額" />
                    <button className="rounded border px-3 py-2">支払い受取</button>
                  </form>
                )}
              </div>
              <form action={listVisibilityAction.bind(null, id, r.id, !r.publicHidden)} className="text-sm">
                <input type="hidden" name="q" value={q} />
                <button className="rounded border px-3 py-1.5">{r.publicHidden ? "公開の参加者一覧に表示する(いま:非表示)" : "公開の参加者一覧から隠す"}</button>
              </form>
              <details className="text-sm"><summary className="cursor-pointer text-red-700">この参加者を削除(取消)</summary>
                <form action={removeParticipantAction.bind(null, id, r.id)} className="mt-2 space-y-2">
                  <input type="hidden" name="q" value={q} />
                  <p className="text-xs text-gray-600">申込を取り消します(記録は残ります)。開始前なら、空いた枠に、キャンセル待ちが繰り上がります。入金済みの場合は、先に入金を取り消してください。</p>
                  <label className="flex items-center gap-2"><input type="checkbox" name="confirm" className="h-5 w-5" /> 取り消すことを確認しました</label>
                  <button className="rounded border border-red-400 px-3 py-2 text-red-700">削除(取消)する</button>
                </form>
              </details>
              <details className="text-sm"><summary className="cursor-pointer">個別料金を変更</summary>
                <form action={feeAction.bind(null, id, r.id)} className="mt-2 flex flex-wrap gap-1">
                  <input type="hidden" name="q" value={q} />
                  <input type="number" name="fee" min={0} defaultValue={r.feeYen} className="w-24 rounded border p-2" aria-label="1人あたりの料金" />
                  <input name="reason" required maxLength={200} placeholder="理由（必須）" className="flex-1 rounded border p-2" />
                  <button className="rounded border px-3 py-2">変更</button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>

      <form action={addMemberParticipantAction.bind(null, id)} className="space-y-2 rounded border p-3">
        <p className="text-sm font-semibold">メンバーを参加者に追加(定員に関係なく、参加確定で登録)</p>
        <input type="hidden" name="q" value={q} />
        <div className="flex gap-2">
          <select name="memberId" required defaultValue="" className="w-full rounded border p-3 text-base" aria-label="メンバー">
            <option value="" disabled>メンバーを選ぶ</option>
            {membersAll.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
          </select>
          <input type="number" name="partySize" min={1} max={10} defaultValue={1} className="w-20 rounded border p-3" aria-label="人数" />
        </div>
        {membersAll.length === 0 && <p className="text-xs text-gray-500">メンバーがまだいません。「メンバー」の画面で、追加してください。</p>}
        <button className="w-full rounded border p-3">参加者に追加する</button>
      </form>

      <form action={walkInAction.bind(null, id)} className="space-y-2 rounded border p-3">
        <p className="text-sm font-semibold">飛び入り追加（受付済みで登録）</p>
        <input type="hidden" name="q" value={q} />
        <div className="flex gap-2">
          <input name="nickname" required maxLength={30} placeholder="ニックネーム" className="w-full rounded border p-3 text-base" autoComplete="off" />
          <input type="number" name="partySize" min={1} max={10} defaultValue={1} className="w-20 rounded border p-3" aria-label="人数" />
        </div>
        <button className="w-full rounded border p-3">追加する</button>
      </form>

      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-semibold">入金履歴</h2>
        {pays.length === 0 && <p className="text-gray-500">入金はまだありません。</p>}
        <ul className="space-y-2">{pays.map((p) => (
          <li key={p.id} className={p.voided ? "text-gray-400 line-through" : ""}>
            <div>{dateText(new Date(p.at).toISOString())} {timeText(new Date(p.at).toISOString())} / {yen(p.amountYen)} / {p.allocations.map((a) => nameOf(a.regId)).join("、")} / {p.by}</div>
            {p.voided ? <div className="no-underline">取消済み: {p.voidReason}</div> : (
              <form action={voidAction.bind(null, id, p.id)} className="mt-1 flex gap-1">
                <input type="hidden" name="q" value={q} />
                <input name="reason" required maxLength={200} placeholder="取消の理由" className="flex-1 rounded border p-2" />
                <button className="rounded border px-3 py-2">取り消す</button>
              </form>
            )}
          </li>
        ))}</ul>
      </section>
      <a href={`/admin/events/${id}/export`} className="block rounded border p-3 text-center text-sm">申込者一覧をCSVで出力</a>
      <Link href={`/admin/events/${id}/print`} className="block rounded border p-3 text-center text-sm">印刷用の受付名簿</Link>
    </main>
  );
}
