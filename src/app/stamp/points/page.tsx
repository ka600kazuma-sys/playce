import Link from "next/link";
import { getMember } from "@/lib/auth/member";
import { getMyPoints, type MyCoupon } from "@/lib/repo/stamps";
import { STAMP_SPORTS, STAMP_SPORT_LABEL, CYCLE } from "@/lib/domain/stamps";
import { lapParity, pointsToNextReward } from "@/lib/domain/stampcard2";
import { rewardShort, rewardText } from "@/lib/domain/stampticket";
import { dateText } from "@/lib/format";
import "../stamp.css";
import "./points.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "ポイント・クーポン | PLAYCE", robots: { index: false, follow: false } };

const couponName = (c: MyCoupon) => (c.kind === "free" ? "参加費1回無料" : `${c.yen}円引き`);

// ポイント画面: 既存のスタンプチケットの見た目(紙のチケット・5つのスタンプ)を引き継ぎ、周回・次の特典・クーポンを見せる。本人の分だけ。
export default async function PointsPage() {
  const member = await getMember();
  if (!member) {
    return (
      <main className="mx-auto max-w-md space-y-4 py-8 text-center">
        <h1 className="font-serif text-xl font-medium text-navy">ポイント・クーポン</h1>
        <p className="text-sm text-soft">ご利用には、ログインが必要です。</p>
        <Link href="/login?next=%2Fstamp%2Fpoints" className="block rounded-2xl bg-navy-deep p-3 font-semibold text-white">ログイン / 新規登録</Link>
      </main>
    );
  }
  const my = await getMyPoints(member.id).catch(() => null);
  if (!my) return <main className="p-4 text-center text-sm">読み込めませんでした。時間をおいて、もう一度お試しください。</main>;
  const active = my.coupons.filter((c) => c.status === "active");
  const past = my.coupons.filter((c) => c.status !== "active");
  return (
    <main className="pt-page">
      <div className="pt-top"><h1>ポイント・クーポン</h1><Link href="/stamp" className="pt-link">スタンプカードへ</Link></div>

      {STAMP_SPORTS.map((sp) => {
        const c = my.cards[sp], par = lapParity(c.lap), rw = my.rewards[par], toNext = pointsToNextReward({ lap: c.lap, points: c.points }), nextPt = c.points < 3 ? 3 : 5;
        return (
          <section key={sp} className={`pt-card ${par}`} aria-label={`${STAMP_SPORT_LABEL[sp]}のポイント`}>
            <div className="pt-band"><span>PLAYCE POINT CARD</span><span>{STAMP_SPORT_LABEL[sp]}</span></div>
            <div className="pt-body">
              <div className="pt-lap"><b>{c.lap}</b>周目<small>{par === "odd" ? "ブルーのカード" : "ゴールドのカード"}</small></div>
              <div className="pt-points" aria-label={`現在${c.points}ポイント`}><b>{c.points}</b><span> / {CYCLE} ポイント</span></div>
              <div className="pt-slots">
                {Array.from({ length: CYCLE }, (_, i) => {
                  const n = i + 1, on = n <= c.points, tier = n === 3 || n === 5;
                  return <div key={n} className={`pt-slot ${on ? "on" : ""} ${tier ? "tier" : ""}`}><span className="n">{on ? "済" : n}</span><span className="t">{tier ? rewardShort(rw[n as 3 | 5]) : on ? "" : "通常"}</span></div>;
                })}
              </div>
              <p className="pt-next">次の特典まで <b>あと{toNext}ポイント</b>({nextPt}ポイントで{rewardText(rw[nextPt as 3 | 5])})</p>
              {!c.enabled && <p className="pt-off">この競技のスタンプカードはOFFです。<Link href="/stamp/settings">設定でONにする</Link></p>}
              <p className="pt-visits">スタンプを付けた参加回数 {c.visits}回</p>
            </div>
          </section>
        );
      })}

      <section className="pt-coupons" aria-label="クーポン">
        <h2>クーポン</h2>
        {active.length === 0 && <p className="pt-empty">使えるクーポンはありません。3ポイント・5ポイントに届くと、特典のクーポンが届きます。</p>}
        <ul>{active.map((c) => (
          <li key={c.id} className={`pt-coupon ${c.kind}`}>
            <b>{couponName(c)}</b><span>{STAMP_SPORT_LABEL[c.sport]} ・ {c.lap > 0 ? `${c.lap}周目 ${c.threshold}ポイント到達` : "主催者から"}</span>
            <small>{c.expiresAt ? `有効期限 ${dateText(new Date(c.expiresAt).toISOString())}` : "有効期限なし"}</small>
          </li>))}</ul>
        <p className="pt-hint">使うときは、受付で主催者に「クーポンを使う」とお伝えください。参加費から引かれます(1回の参加で1枚)。</p>
        {past.length > 0 && (
          <details className="pt-past"><summary>使用済み・取り消し済み({past.length})</summary>
            <ul>{past.map((c) => <li key={c.id}>{couponName(c)} ・ {STAMP_SPORT_LABEL[c.sport]} ・ {c.status === "used" ? `使用済み${c.usedAt ? `(${dateText(new Date(c.usedAt).toISOString())})` : ""}` : "取り消し済み"}</li>)}</ul>
          </details>
        )}
      </section>
    </main>
  );
}
