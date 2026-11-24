import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { REASONS, memberStamp, searchMembers } from "@/lib/repo/stampadmin";
import { STAMP_SPORTS, STAMP_SPORT_LABEL } from "@/lib/domain/stamps";
import { dateText, timeText } from "@/lib/format";
import { adjustAction, cancelCouponAction, issueCouponAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "会員のスタンプ操作 | PLAYCE 管理", robots: { index: false, follow: false } };
const yen = (n: number) => `${n.toLocaleString()}円`;
const jt = (ms: number) => `${dateText(new Date(ms).toISOString())} ${timeText(new Date(ms).toISOString())}`;
const KIND: Record<string, string> = { bonus: "ポイント付与(ボーナス)", revoke: "ポイント取り消し", coupon_issue: "クーポン発行", coupon_cancel: "クーポン取り消し", coupon_use: "クーポン使用" };

export default async function AdminStampMembers({ searchParams }: { searchParams: Promise<{ q?: string; m?: string; ok?: string; err?: string; warn?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 30);
  const hits = q ? await searchMembers(q).catch(() => []) : [];
  const info = sp.m ? await memberStamp(sp.m).catch(() => null) : null;
  const op = () => crypto.randomUUID().replaceAll("-", "");
  const f = "w-full rounded border p-2";
  return (
    <main className="space-y-4">
      <Link href="/admin/stamp" className="text-sm">← スタンプカード</Link>
      <h1 className="text-xl font-bold">会員のスタンプ操作</h1>
      <p className="text-sm text-gray-600">参加登録やQRの読み取りがなくても、任意の会員にポイントを付与・取り消しできます。すべて理由つきで記録され、通常の参加ポイントとは区別されます。</p>
      {sp.ok && <p className="rounded border p-3 text-sm">{sp.ok}</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="ニックネームで検索" className="w-full rounded border p-3" autoComplete="off" /><button className="rounded border px-4">検索</button></form>
      {q && !info && <ul className="space-y-1 text-sm">{hits.length === 0 && <li className="text-gray-500">該当する会員がいません。</li>}{hits.map((h) => <li key={h.id}><Link href={`/admin/stamp/members?m=${h.id}`} className="underline">{h.nickname}</Link></li>)}</ul>}
      {info && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{info.nickname}</h2>
          <div className="grid gap-2 sm:grid-cols-2">{STAMP_SPORTS.map((s) => { const c = info.cards[s]; return (
            <div key={s} className="rounded border p-3 text-sm"><b>{STAMP_SPORT_LABEL[s]}</b>{!c.enabled && <span className="ml-2 text-xs text-gray-500">(カードOFF)</span>}
              <div>{c.lap}周目({c.lap % 2 === 1 ? "奇数周" : "偶数周"}) {c.points} / 5 ポイント ・ 次の特典まであと {c.toNext}</div>
              <div className="text-xs text-gray-600">参加回数(スタンプ付与回): {c.visits}回 ※ポイントとは別管理</div></div>); })}</div>

          <form action={adjustAction.bind(null, info.id)} className="space-y-2 rounded border p-3">
            <p className="text-sm font-semibold">ポイントの付与・取り消し</p>
            <input type="hidden" name="opId" value={op()} />
            <input type="hidden" name="expect" value={/^[A-Za-z0-9_,-]{0,400}$/.test(sp.warn ?? "") ? (sp.warn ?? "") : ""} />
            <div className="grid grid-cols-2 gap-2">
              <select name="sport" className={f} aria-label="競技">{STAMP_SPORTS.map((s) => <option key={s} value={s}>{STAMP_SPORT_LABEL[s]}</option>)}</select>
              <select name="dir" className={f} aria-label="操作"><option value="grant">付与する</option><option value="revoke">取り消す</option></select>
              <input type="number" name="count" min={1} max={100} defaultValue={1} required className={f} aria-label="個数" />
              <select name="reason" required className={f} aria-label="理由">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
            </div>
            <input name="note" maxLength={200} placeholder="補足(任意・200文字まで)" className={f} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="h-5 w-5" /> 取り消しでクーポンと合わなくなる場合も、確認のうえ実行する</label>
            <button className="w-full rounded bg-black p-3 font-semibold text-white">実行する</button>
          </form>

          <form action={issueCouponAction.bind(null, info.id)} className="space-y-2 rounded border p-3">
            <p className="text-sm font-semibold">クーポンの手動発行</p>
            <input type="hidden" name="opId" value={op()} />
            <div className="grid grid-cols-2 gap-2">
              <select name="sport" className={f} aria-label="競技">{STAMP_SPORTS.map((s) => <option key={s} value={s}>{STAMP_SPORT_LABEL[s]}</option>)}</select>
              <select name="kind" className={f} aria-label="種類"><option value="discount">割引</option><option value="free">参加費無料</option></select>
              <input type="number" name="yen" min={0} max={100000} placeholder="割引額(円)" className={f} />
              <select name="reason" required className={f} aria-label="理由">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
            </div>
            <input name="note" maxLength={200} placeholder="補足(任意)" className={f} />
            <button className="w-full rounded border p-3">発行する</button>
          </form>

          <section className="space-y-2 text-sm"><h3 className="font-semibold">クーポン</h3>
            {info.coupons.length === 0 && <p className="text-gray-500">クーポンはありません。</p>}
            <ul className="space-y-2">{info.coupons.map((c) => (
              <li key={c.id} className="rounded border p-2">
                <div><b>{c.kind === "free" ? "参加費無料" : `${yen(c.yen)}引き`}</b> ・ {STAMP_SPORT_LABEL[c.sport as keyof typeof STAMP_SPORT_LABEL] ?? c.sport} ・ {c.status === "active" ? "未使用" : c.status === "used" ? "使用済み" : "取り消し済み"}</div>
                <div className="text-xs text-gray-600">{c.reason} ・ 発行 {jt(c.issuedAt)}{c.usedAt ? ` ・ 使用 ${jt(c.usedAt)}(イベント ${c.usedEventId})` : ""}{c.expiresAt ? ` ・ 期限 ${jt(c.expiresAt)}` : " ・ 期限なし"}</div>
                {c.status === "active" && (
                  <form action={cancelCouponAction.bind(null, info.id, c.id)} className="mt-1 flex gap-1">
                    <select name="reason" className="rounded border p-1" aria-label="取り消しの理由">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                    <button className="rounded border px-3 py-1">取り消す</button>
                  </form>)}
              </li>))}</ul>
          </section>

          <section className="space-y-1 text-sm"><h3 className="font-semibold">管理者操作の履歴</h3>
            {info.ledger.length === 0 && <p className="text-gray-500">履歴はありません。</p>}
            <ul className="space-y-1">{info.ledger.map((l) => <li key={l.id} className="text-xs">{jt(l.at)} ・ {KIND[l.kind] ?? l.kind}{l.delta ? ` ${l.delta > 0 ? "+" : ""}${l.delta}` : ""} ・ {l.reason}{l.note ? `(${l.note})` : ""} ・ {l.by}</li>)}</ul>
          </section>
        </section>
      )}
    </main>
  );
}
