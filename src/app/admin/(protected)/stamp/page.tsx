import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { adminStampEvents, getTiers } from "@/lib/repo/stamps";
import { STAMP_SPORTS, STAMP_SPORT_LABEL } from "@/lib/domain/stamps";
import { dateText, timeText } from "@/lib/format";
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
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  const [tiers, events] = await Promise.all([getTiers(), adminStampEvents().catch(() => null)]);
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">スタンプカード</h1>
      {sp.ok === "1" && <p className="rounded border p-3 text-sm">割引額を保存しました(履歴に残ります)。</p>}
      {sp.ok === "2" && <p className="rounded border p-3 text-sm">タグのURLを再発行しました。古いURL・タグは使えません。新しいURLをタグに書き込んでください。</p>}
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
        <h2 className="font-semibold">イベントごとのタグ(NFC・QR)</h2>
        <p className="text-xs text-gray-600">各イベントのURLを、NFCタグに書き込みます(スマホのNFC書き込みアプリで「URL」として書き込む)。同じURLのQRコードも出ます(NFCが使えない端末用)。参加者がかざすと、スタンプが付きます。開始の3時間前から、終了の6時間後まで読み取れます。URLは他の人に見せないでください。</p>
        {events === null && <p className="text-sm text-red-700">読み込めませんでした。</p>}
        {events?.length === 0 && <p className="text-sm text-gray-500">対象のイベント(公開中のバドミントン・バレーボール)がありません。</p>}
        <ul className="space-y-3">
          {events?.map((e) => {
            const url = e.token ? `${proto}://${host}/stamp/t/${e.id}/${e.token}` : "";
            return (
              <li key={e.id} className="space-y-2 rounded border p-3 text-sm">
                <div className="font-semibold">{e.title} <span className="font-normal text-gray-600">({STAMP_SPORT_LABEL[e.sport]})</span></div>
                <div className="text-xs text-gray-600">{dateText(e.startAt)} {timeText(e.startAt)}〜 / {e.venue} / タグ第{e.version}版 / スタンプ取得 {e.taps}人</div>
                {url ? <><code className="block break-all rounded bg-gray-50 p-2 text-xs select-all">{url}</code><CopyButton text={url} />
                  <div className="space-y-1"><QrCode text={url} label={`${e.title}のタグ用QRコード`} /><p className="text-xs text-gray-600">QRコード(NFCが使えない端末用。印刷して会場に掲示できます)。スマホのカメラで読むと、同じURLが開き、スタンプが付きます。再発行すると、このQRも使えなくなります。</p></div></> : <p className="text-red-700">秘密の設定(FORM_SECRET)がないため、URLを作れません。</p>}
                <details><summary className="cursor-pointer text-red-700">URLを再発行する</summary>
                  <form action={reissueTagAction.bind(null, e.id)} className="mt-2 space-y-2">
                    <p className="text-xs text-gray-600">古いURL・すでに書き込んだタグは、使えなくなります。タグが盗まれた・URLが漏れたときに使います。</p>
                    <label className="flex items-center gap-2"><input type="checkbox" name="confirm" className="h-5 w-5" /> 古いタグが使えなくなることを確認しました</label>
                    <button className="rounded border border-red-400 px-3 py-2 text-red-700">再発行する</button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
