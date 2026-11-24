import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { adminQrTokens, adminStampEvents, adminStampTags, getTiers } from "@/lib/repo/stamps";
import { STAMP_SPORTS, STAMP_SPORT_LABEL } from "@/lib/domain/stamps";
import { dateText, timeText } from "@/lib/format";
import { publicOrigin } from "@/lib/domain/origin";
import { CopyButton } from "./CopyButton";
import { QrCode } from "./QrCode";
import { reissueTagAction, saveTiersAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "スタンプカード | PLAYCE 管理", robots: { index: false, follow: false } };

const ERR: Record<string, string> = { "1": "金額が正しくありません(0〜100000の整数)。", "2": "処理できませんでした。時間をおいて、もう一度お試しください。", "3": "再発行の確認にチェックを入れてください。" };

export default async function AdminStamp({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const h = await headers();
  // タグ・QRに入れる、公開用のアドレス。Host は、本番では内部のアドレス(*.run.app。直接開くと Forbidden)のことがあるため使わない。本番は PUBLIC_ORIGIN、開発はヘッダー。
  const origin = publicOrigin({ configured: process.env.PUBLIC_ORIGIN, forwardedHost: h.get("x-forwarded-host"), host: h.get("host"), allowHeaders: process.env.NODE_ENV !== "production" }); // 本番は、設定(PUBLIC_ORIGIN)だけを使う(ヘッダーは、クライアント由来の値が混ざりうるため)
  const [tiers, tags, events] = await Promise.all([getTiers(), adminStampTags(), adminStampEvents().catch(() => null)]);
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">スタンプカード</h1>
      {sp.ok === "1" && <p className="rounded border p-3 text-sm">割引額を保存しました(履歴に残ります)。</p>}
      {sp.ok === "2" && <p className="rounded border p-3 text-sm">タグのURLを再発行しました。古いURL・タグ・QRは使えません。新しいURLをタグに書き込み直してください。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{ERR[sp.err] ?? ERR["2"]}</p>}

      <form action={saveTiersAction} className="space-y-3 rounded border p-3">
        <h2 className="font-semibold">割引額(3ポイント目・5ポイント目の回に引く金額)</h2>
        <p className="text-xs text-gray-600">参加費を超える割引にはなりません。5ポイントの次は0に戻ります。変更は、これから適用する割引から有効です(適用済みの割引は変わりません)。</p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div />
          <div className="font-semibold">3ポイント目</div><div className="font-semibold">5ポイント目</div>
          {STAMP_SPORTS.map((s) => (
            <div key={s} className="contents">
              <div className="self-center">{STAMP_SPORT_LABEL[s]}</div>
              <input type="number" name={`${s}_3`} min={0} max={100000} step={50} required defaultValue={tiers[s][3]} className="rounded border p-2" aria-label={`${STAMP_SPORT_LABEL[s]}の3ポイント目の割引(円)`} />
              <input type="number" name={`${s}_5`} min={0} max={100000} step={50} required defaultValue={tiers[s][5]} className="rounded border p-2" aria-label={`${STAMP_SPORT_LABEL[s]}の5ポイント目の割引(円)`} />
            </div>
          ))}
        </div>
        <button className="rounded bg-black px-4 py-2 font-semibold text-white">保存する</button>
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">スタンプのタグ(NFC・QR)― 競技ごとに1枚、毎回同じものを使います</h2>
        <p className="text-xs text-gray-600">バドミントン用・バレーボール用に、それぞれ1枚のタグを作ります(スマホのNFC書き込みアプリで、下のURLを「URL」として書き込む)。イベントごとに書き直す必要はありません。参加者がかざすと、その人が参加確定で申し込んでいるイベントにスタンプが付きます(開始の3時間前から、終了の90日後まで。付け忘れの後づけも可能。開催中のイベントが先で、なければ、新しい順に1回につき1イベント)。申込のあるイベントには、欠席でも付けられます。URLは他の人に見せないでください。QRコードは、NFCが使えない端末用です(いつでも使えるため、掲示しないでください)。</p>
        <ul className="space-y-3">
          {tags.map((t) => {
            const url = t.token && origin ? `${origin}/stamp/t/${t.sport}/${t.token}` : "";
            return (
              <li key={t.sport} className="space-y-2 rounded border p-3 text-sm">
                <div className="font-semibold">{STAMP_SPORT_LABEL[t.sport]}用のタグ <span className="text-xs font-normal text-gray-600">(第{t.version}版)</span></div>
                {url ? (
                  <>
                    <code className="block break-all rounded bg-gray-50 p-2 text-xs select-all">{url}</code>
                    <CopyButton text={url} />
                    <div className="space-y-1">
                      <QrCode text={url} label={`${STAMP_SPORT_LABEL[t.sport]}用のタグのQRコード`} fullscreenTitle={`${STAMP_SPORT_LABEL[t.sport]}用 スタンプQR`} />
                      <p className="text-xs text-gray-600">スマホのカメラで読むと、タグと同じURLが開き、スタンプが付きます。「画面いっぱいに表示」を押すと、このスマホ・タブレットの画面にQRを大きく出せます(参加者に読み取ってもらう用。読み取ってもらう間だけ表示し、写真・スクリーンショットを撮ったり共有したりしないよう、参加者にお伝えください。QRを写真で保存されると、会場の外からでも読み取れてしまいます)。再発行すると、このQRも使えなくなります。</p>
                    </div>
                  </>
                ) : <p className="text-red-700">{!t.token ? "秘密の設定(FORM_SECRET)がないため、URLを作れません。" : "公開用のアドレスを特定できないため、URLを作れません。PUBLIC_ORIGIN を設定してください。"}</p>}
                <details><summary className="cursor-pointer text-red-700">URLを再発行する</summary>
                  <form action={reissueTagAction.bind(null, t.sport)} className="mt-2 space-y-2">
                    <p className="text-xs text-gray-600">古いURL・すでに書き込んだタグ・QRは、使えなくなります。タグが盗まれた・URLが漏れたときに使います。</p>
                    <label className="flex items-center gap-2"><input type="checkbox" name="confirm" className="h-5 w-5" /> 古いタグが使えなくなることを確認しました</label>
                    <button className="rounded border border-red-400 px-3 py-2 text-red-700">再発行する</button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">イベントごとのスタンプ取得人数 / 付け忘れ用のQR(1個・2個)</h2>
        <p className="text-xs text-gray-600">スタンプを付けられなかった人用のQRです。イベントごとに「1個」「2個」の2種類があり、参加者がアプリの「QRを読み取る」で読むと、そのイベントに、その個数のスタンプが付きます(参加確定の申込がある人が、1イベントにつき1回だけ。すでにタグで付いた人には付きません)。2個のQRは、前回も付けられなかった人用です(5ポイントの次は1に戻るため、4ポイントの人に2個付くと、1ポイントになります)。このQRは、そのイベントの終了から90日間、読み取れます(この画面に出るのは、終了から14日以内のイベントです)。同じイベントの1個用・2個用を、同時に参加者へ見せないでください(どちらか1回しか付きません)。読み取ってもらう間だけ表示し、撮影・共有はしないでください。</p>
        {events === null && <p className="text-sm text-red-700">読み込めませんでした。</p>}
        {events?.length === 0 && <p className="text-sm text-gray-500">対象のイベント(公開中のバドミントン・バレーボール)がありません。</p>}
        <ul className="space-y-1 text-sm">
          {events?.map((e) => (
            <li key={e.id} className="rounded border p-2">
              <span className="font-semibold">{e.title}</span> <span className="text-gray-600">({STAMP_SPORT_LABEL[e.sport]})</span>
              <div className="text-xs text-gray-600">{dateText(e.startAt)} {timeText(e.startAt)}〜 / {e.venue} / スタンプ取得 {e.taps}人</div>
              {origin && adminQrTokens(e.id) && (
                <details className="mt-2"><summary className="cursor-pointer font-semibold text-blue-800">付け忘れ用のQRを表示</summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {([1, 2] as const).map((n) => (
                      <div key={n} className="space-y-1">
                        <div className="font-semibold">スタンプ{n}個用</div>
                        <QrCode text={`${origin}/stamp/q/${e.id}/${n}/${adminQrTokens(e.id)![n]}`} label={`${e.title} スタンプ${n}個用のQRコード`} fullscreenTitle={`スタンプ${n}個 ${e.title}`} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
