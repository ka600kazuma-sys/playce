import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getEventAny } from "@/lib/repo/adminEvents";
import { ensureNumbers, getAdminPlan } from "@/lib/repo/matches";
import { statsOf } from "@/lib/domain/matchmaking";
import { distributeAt } from "@/lib/domain/numbers";
import { dateText, timeText } from "@/lib/format";
import { distributeNowAction, generateAction, publishAction, saveDraftAction, saveSettingsAction } from "./actions";

export const dynamic = "force-dynamic";
const OK: Record<string, string> = { settings: "設定を保存しました。", numbers: "参加番号を配布(追加)しました。", generated: "組み合わせを生成しました(下書き)。内容を確認して「公開」を押してください。", saved: "下書きを保存しました。", published: "公開しました。参加者の画面に反映されます。" };
const box = "rounded border p-3 space-y-2";
const inp = "mt-1 block w-full rounded border p-2";

export default async function MatchesAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string; warn?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const e = await getEventAny(id).catch(() => null);
  if (!e) notFound();
  await ensureNumbers(id); // 開始1時間前を過ぎていれば、ここでも配布(アクセス時の遅延実行)
  const plan = await getAdminPlan(id);
  const st = plan.settings, active = plan.players.filter((p) => p.active);
  const rows = plan.draft?.matches ?? [];
  const stats = plan.draft && st ? statsOf(plan.draft.matches, active.map((p) => p.number)) : null;
  const state = !plan.draft ? "未生成" : !plan.published ? "下書き(未公開)" : plan.dirty ? "公開中(未公開の変更あり)" : "公開中";
  const at = new Date(distributeAt(e.startAt)).toISOString();
  return (
    <main className="space-y-4">
      <Link href={`/admin/events/${id}`} className="text-sm">← イベント編集へ</Link>
      <h1 className="text-xl font-bold">試合管理: {e.title}</h1>
      <p className="text-sm text-gray-600">状態: <strong>{state}</strong>。参加番号は開始1時間前({dateText(at)} {timeText(at)})に自動配布されます(画面を開いたときに実行)。</p>
      {sp.ok && OK[sp.ok] && <p className="rounded border p-3 text-sm">{OK[sp.ok]}</p>}
      {sp.warn && <p className="rounded border border-yellow-500 p-3 text-sm">注意: {sp.warn}</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}

      <form action={saveSettingsAction.bind(null, id)} className={box}>
        <h2 className="font-semibold">1. 試合の設定</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="col-span-2">競技<input name="sport" required maxLength={30} defaultValue={st?.sport ?? ""} placeholder="例: バドミントン ダブルス" className={inp} /></label>
          <label>コート数<input name="courts" type="number" min={1} max={20} required defaultValue={st?.courts ?? 2} className={inp} /></label>
          <label>1チームの人数<input name="teamSize" type="number" min={1} max={11} required defaultValue={st?.teamSize ?? 2} className={inp} /></label>
          <label>対戦チーム数<input name="teams" type="number" min={2} max={4} required defaultValue={st?.teams ?? 2} className={inp} /></label>
          <label>1人あたりの希望試合数<input name="perPlayer" type="number" min={1} max={30} required defaultValue={st?.perPlayer ?? 4} className={inp} /></label>
        </div>
        <p className="text-xs text-gray-500">シングルス=1人×2チーム、ダブルス=2人×2チーム、バレー6人制=6人×2チーム。設定の変更は、次の生成から反映されます。</p>
        <button className="w-full rounded border p-2">設定を保存</button>
      </form>

      <section className={box}>
        <h2 className="font-semibold">2. 参加番号({plan.distributed ? `配布済み・${active.length}人` : "番号配布前"})</h2>
        <form action={distributeNowAction.bind(null, id)}><button className="w-full rounded border p-2 text-sm">{plan.distributed ? "新しい参加者の番号を追加" : "今すぐ番号を配布(開始1時間前を待たない)"}</button></form>
        {plan.players.length > 0 && (
          <ul className="grid grid-cols-2 gap-1 text-sm">{plan.players.map((p) => (
            <li key={`${p.regId}_${p.idx}`} className={p.active ? "" : "text-gray-400 line-through"}><strong>{p.number}</strong> {p.label}{p.idx > 0 ? "(同行者)" : ""}{p.active ? "" : "(欠番)"}</li>
          ))}</ul>
        )}
      </section>

      <section className={box}>
        <h2 className="font-semibold">3. 組み合わせの生成(下書き)</h2>
        <form action={generateAction.bind(null, id)} className="space-y-2">
          <label className="block text-sm">実施済みの試合番号(1〜この番号まで保持。空欄なら全試合を作り直す)
            <input name="keepUpTo" type="number" min={0} max={500} placeholder="例: 8" className={inp} /></label>
          <button className="w-full rounded bg-black p-2 font-semibold text-white">{rows.length ? "再生成して下書きを置き換える" : "組み合わせを自動生成"}</button>
          <p className="text-xs text-gray-500">当日の参加・キャンセルを反映するときは、実施済みの試合番号を入れて再生成します。参加番号は変わりません。再生成後は確認して再公開してください。</p>
        </form>
      </section>

      {rows.length > 0 && st && (
        <form action={saveDraftAction.bind(null, id)} className={box}>
          <h2 className="font-semibold">4. 下書きの確認・修正(全{rows.length}試合)</h2>
          {stats && <p className="text-xs text-gray-600">1人あたり {stats.minPlayed}〜{stats.maxPlayed} 試合 / 同じペア重複 {stats.repeatPartners} / 同じ対戦重複 {stats.repeatOpponents} / 連続出場 {stats.back2back}</p>}
          {plan.draft?.warnings.map((w) => <p key={w} className="text-xs text-yellow-700">注意: {w}</p>)}
          <input type="hidden" name="n" value={rows.length + 1} />
          <div className="space-y-2">
            {[...rows, null].map((m, i) => (
              <fieldset key={i} className="rounded border p-2 text-sm">
                <legend className="px-1 text-xs text-gray-500">{m ? `試合${m.no}` : "追加(使わなければ空欄)"}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <label>時間帯<input name={`r_${i}`} type="number" min={1} defaultValue={m?.round} className="ml-1 w-16 rounded border p-1" /></label>
                  <label>コート<input name={`c_${i}`} type="number" min={1} max={st.courts} defaultValue={m?.court} className="ml-1 w-16 rounded border p-1" /></label>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {Array.from({ length: st.teams }, (_, k) => (
                    <span key={k} className="flex items-center gap-1">{k > 0 && <span className="px-1 text-gray-400">vs</span>}
                      {Array.from({ length: st.teamSize }, (_, j) => <input key={j} name={`t_${i}_${k}_${j}`} type="number" min={1} defaultValue={m?.teams[k]?.[j]} aria-label={`チーム${k + 1}の${j + 1}人目の参加番号`} className="w-14 rounded border p-1" />)}
                    </span>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <p className="text-xs text-gray-500">同じ時間帯に同じ番号が複数の試合に入る、コートが重なる、人数が合わない場合は保存できません。試合を削除するには、その行をすべて空にします。試合番号は、時間帯→コートの順に振り直されます。</p>
          <button className="w-full rounded border p-2 font-semibold">下書きを保存</button>
        </form>
      )}

      {rows.length > 0 && (
        <form action={publishAction.bind(null, id)} className={box}>
          <h2 className="font-semibold">5. 公開</h2>
          <p className="text-sm">{plan.published ? `公開中(第${plan.published.version}版)。${plan.dirty ? "下書きに、まだ公開していない変更があります。" : "公開内容と下書きは同じです。"}` : "まだ公開されていません。参加者には「試合情報はまだ公開されていません」と表示されています。"}</p>
          <button disabled={!!plan.published && !plan.dirty} className="w-full rounded bg-black p-3 font-semibold text-white disabled:opacity-40">{plan.published ? "変更を公開" : "公開する"}</button>
        </form>
      )}
    </main>
  );
}
