import { requireAdmin } from "@/lib/auth/session";
import { listPublicEvents } from "@/lib/repo/events";
import { listVenues } from "@/lib/repo/venues";
import { mapUrlProblem, searchUrl, venueKey } from "@/lib/domain/venues";
import { deleteVenueAction, saveVenueAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "会場 | PLAYCE 管理", robots: { index: false, follow: false } };

export default async function AdminVenues({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [registered, events] = await Promise.all([listVenues().catch(() => null), listPublicEvents().catch(() => [])]);
  const regKeys = new Set((registered ?? []).map((v) => venueKey(v.name)));
  // イベントで使われている会場のうち、まだ登録していないもの(登録しなくても、会場名でのGoogleマップ検索リンクで開く)
  const unregistered = [...new Set(events.map((e) => e.venue))].filter((n) => !regKeys.has(venueKey(n))).sort((a, b) => a.localeCompare(b, "ja"));
  const input = "w-full rounded border p-2 text-sm";
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">会場(Googleマップのリンク)</h1>
      <p className="text-sm text-gray-600">カレンダー・イベント詳細・スタンプのチケットで、会場名を押すとGoogleマップが開きます。登録しなくても、会場名でのGoogleマップ検索が開きます。場所をはっきり指定したい会場だけ、地図のURLを登録してください(あとから、いつでも追加・変更できます)。</p>
      {sp.ok === "1" && <p className="rounded border p-3 text-sm">保存しました。</p>}
      {sp.ok === "2" && <p className="rounded border p-3 text-sm">登録を削除しました(会場名でのGoogleマップ検索に戻ります)。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}

      <form action={saveVenueAction} className="space-y-2 rounded border p-3">
        <h2 className="font-semibold">会場を追加・更新する</h2>
        <label className="block text-sm font-semibold">会場名(イベントの「場所」と同じ名前)<input name="name" required maxLength={100} placeholder="例: 播磨町総合体育館" className={input} /></label>
        <label className="block text-sm font-semibold">GoogleマップのURL<input name="mapUrl" required maxLength={500} inputMode="url" placeholder="https://maps.app.goo.gl/..." className={input} /></label>
        <p className="text-xs text-gray-600">Googleマップで会場を開き、「共有」→「リンクをコピー」したURLを貼り付けます(maps.app.goo.gl などの短縮リンクも使えます)。同じ会場名で保存すると、上書きします。</p>
        <button className="rounded bg-black px-4 py-2 font-semibold text-white">保存する</button>
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">登録済みの会場</h2>
        {registered === null && <p className="text-sm text-red-700">読み込めませんでした。</p>}
        {registered?.length === 0 && <p className="text-sm text-gray-500">まだ登録がありません。</p>}
        <ul className="space-y-2">
          {registered?.map((v) => (
            <li key={v.id} className="space-y-2 rounded border p-3 text-sm">
              <div className="font-semibold">{v.name}</div>
              {mapUrlProblem(v.mapUrl) === null
                ? <a href={v.mapUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-blue-700 underline">{v.mapUrl}</a>
                : <p role="alert" className="break-all text-xs text-red-700">登録のURLが正しくありません(Googleマップのリンクではありません)。いまは、会場名の検索リンクが使われています。下の「URLを変更する」で直してください。</p>}
              <details><summary className="cursor-pointer">URLを変更する</summary>
                <form action={saveVenueAction} className="mt-2 space-y-2">
                  <input type="hidden" name="name" value={v.name} />
                  <input name="mapUrl" required maxLength={500} inputMode="url" defaultValue={v.mapUrl} className={input} aria-label={`${v.name}のGoogleマップURL`} />
                  <button className="rounded border px-3 py-1.5">更新する</button>
                </form>
              </details>
              <details><summary className="cursor-pointer text-red-700">登録を削除する</summary>
                <form action={deleteVenueAction.bind(null, v.id)} className="mt-2 space-y-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="confirm" className="h-5 w-5" /> 削除することを確認しました(会場名の検索リンクに戻ります)</label>
                  <button className="rounded border border-red-400 px-3 py-1.5 text-red-700">削除する</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">イベントで使われている、未登録の会場</h2>
        <p className="text-xs text-gray-600">いまは、会場名でのGoogleマップ検索が開きます。リンクを確認して、場所が違うときは、URLを登録してください。</p>
        {unregistered.length === 0 && <p className="text-sm text-gray-500">未登録の会場はありません。</p>}
        <ul className="space-y-2">
          {unregistered.map((n) => (
            <li key={n} className="space-y-2 rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{n}</span><a href={searchUrl(n)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline">検索リンクを確認</a></div>
              <form action={saveVenueAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="name" value={n} />
                <input name="mapUrl" required maxLength={500} inputMode="url" placeholder="https://maps.app.goo.gl/..." className={`${input} flex-1`} aria-label={`${n}のGoogleマップURL`} />
                <button className="rounded border px-3 py-1.5">登録する</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
