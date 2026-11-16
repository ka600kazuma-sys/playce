import Link from "next/link";
import { getMember } from "@/lib/auth/member";
import { getCards, getTiers } from "@/lib/repo/stamps";
import { STAMP_SPORTS, STAMP_SPORT_LABEL } from "@/lib/domain/stamps";
import { toggleStampAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "スタンプカード設定 | PLAYCE", robots: { index: false, follow: false } };

export default async function StampSettings({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const m = await getMember();
  if (!m) {
    return (
      <main className="mx-auto max-w-md space-y-4 py-8 text-center">
        <h1 className="font-serif text-xl font-medium text-navy">スタンプカード設定</h1>
        <p className="text-sm text-soft">設定するには、ログインが必要です。</p>
        <Link href="/login?next=%2Fstamp%2Fsettings" className="block rounded-2xl bg-navy-deep p-3 font-semibold text-white">ログイン / 新規登録</Link>
      </main>
    );
  }
  const sp = await searchParams;
  const [cards, tiers] = await Promise.all([getCards(m.id), getTiers()]);
  const card = "rounded-2xl border border-line bg-surface p-4";
  return (
    <main className="mx-auto max-w-md space-y-4 py-4">
      <h1 className="font-serif text-2xl font-bold text-ink">スタンプカード設定</h1>
      <p className="text-sm text-soft">スタンプカードは、貯めたい人だけが使えます。競技ごとに選べます。</p>
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">変更できませんでした。時間をおいて、もう一度お試しください。</p>}
      <section className={card}>
        {STAMP_SPORTS.map((s, i) => (
          <form key={s} action={toggleStampAction} className={`flex items-center justify-between gap-3 ${i > 0 ? "mt-4 border-t border-line pt-4" : ""}`}>
            <input type="hidden" name="sport" value={s} />
            <input type="hidden" name="enabled" value={cards[s].enabled ? "0" : "1"} />
            <div>
              <div className="font-semibold">{STAMP_SPORT_LABEL[s]}</div>
              <div className="text-xs text-soft">{cards[s].enabled ? `ON ― 現在 ${cards[s].points} / 5 ポイント` : "OFF ― 貯まりません"}</div>
            </div>
            <button role="switch" aria-checked={cards[s].enabled} aria-label={`${STAMP_SPORT_LABEL[s]}のスタンプカードを使う`}
              className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition ${cards[s].enabled ? "bg-blue" : "bg-[#c9d0df]"}`}>
              <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${cards[s].enabled ? "left-[25px]" : "left-[3px]"}`} />
            </button>
          </form>
        ))}
      </section>
      <section className={card}>
        <h2 className="mb-2 font-serif text-base font-bold">ご利用について</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>ONにする前の出席は、さかのぼって付きません。</li>
          <li>OFFの間は、ポイントが貯まりません(これまでのポイントは残ります)。</li>
          <li>ポイントは、支払いのあとに会場のタグをかざすと付きます(1イベント1回)。</li>
          <li>5ポイントの次は0に戻り、1ポイント目から貯め直します。</li>
          <li>メンバーを削除すると、スタンプの記録も削除されます。</li>
        </ul>
      </section>
      <section className={card}>
        <h2 className="mb-2 font-serif text-base font-bold">割引</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-soft"><th className="py-1">ポイント</th>{STAMP_SPORTS.map((s) => <th key={s}>{STAMP_SPORT_LABEL[s]}</th>)}</tr></thead>
          <tbody>
            {([3, 5] as const).map((p) => (
              <tr key={p} className="border-t border-line"><td className="py-2">{p}ポイント目</td>{STAMP_SPORTS.map((s) => <td key={s}>{tiers[s][p]}円引き</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-soft">割引は、当日の受付・支払い時に適用されます。割引額は、変わることがあります。</p>
      </section>
    </main>
  );
}
