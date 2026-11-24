import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "受付 | PLAYCE", robots: { index: false, follow: false } };

// 受付QRを読んだ結果の案内(暫定の簡素な画面。見た目は、UI案の選択後に作り直す)。表示するのは固定の文言だけ(クエリの値は文言の選択にだけ使う)。
const MSG: Record<string, [string, string]> = {
  checked_in: ["受付しました", "参加費のお支払い確認が済むと、スタンプが付きます。"],
  walkin_ok: ["当日参加として受付しました", "参加費のお支払い確認が済むと、スタンプが付きます。"],
  already: ["受付済みです", "もう一度読み取る必要はありません。"],
  pending: ["主催者の確認待ちです", "定員または時間の都合で、主催者の承認が必要です。スタッフにお声がけください。"],
  waiting: ["キャンセル待ちの状態です", "スタッフにお声がけください。"],
  closed: ["受付できません", "当日参加の受付は、開催日の23:59までです。"],
  expired: ["QRの有効期限が切れました", "会場の画面に表示されている最新のQRを読み取ってください。"],
  early: ["まだ読み取れません", "端末の時刻がずれている可能性があります。"],
  bad: ["このQRは使えません", "会場の画面のQRを、もう一度読み取ってください。"],
  invalid: ["受付できませんでした", "イベントが見つかりません。"],
  busy: ["混み合っています", "少し待ってからお試しください。"],
  retry: ["処理できませんでした", "時間をおいて、もう一度お試しください。"],
};
export default async function ResultPage({ searchParams }: { searchParams: Promise<{ r?: string; m?: string }> }) {
  const sp = await searchParams;
  const [h, p] = (typeof sp.r === "string" && Object.hasOwn(MSG, sp.r) ? MSG[sp.r] : MSG.retry);
  const multi = sp.m === "2" || sp.m === "3" ? Number(sp.m) : 1;
  return (
    <main className="mx-auto max-w-md space-y-4 py-10 text-center">
      <h1 className="font-serif text-xl font-medium text-navy">{h}</h1>
      <p className="text-sm text-soft">{p}</p>
      {multi > 1 && <p className="font-semibold text-navy">本日はスタンプ{multi}倍DAY!</p>}
      <Link href="/stamp" className="block rounded-2xl bg-navy-deep p-3 font-semibold text-white">スタンプカードを見る</Link>
    </main>
  );
}
