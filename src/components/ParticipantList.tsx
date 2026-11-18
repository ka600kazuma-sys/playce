import type { PublicParticipants } from "@/lib/domain/participants";

// 参加表明の一覧(公開)。代表者のニックネームと、本人が表示を選んだ人の写真だけを表示し、同行者・非表示の人は人数にだけ含める。
// 写真がない人は、ニックネームの頭文字を円の中に出す。写真は /photo/[公開用キー](メンバーとは無関係のキー)から取得する。
export function ParticipantList({ p }: { p: PublicParticipants | undefined }) {
  const total = p?.total ?? 0;
  const names = p?.names ?? [];
  const photos = p?.photos ?? [];
  const rest = total - names.length;
  return (
    <div className="grid gap-1.5" aria-label="参加表明">
      <p className="text-[15px] font-semibold">参加表明 {total}人</p>
      {total === 0 ? <p className="text-sm text-soft">まだ参加表明はありません。</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((n, i) => (
            <li key={`${i}-${n}`} className="flex items-center gap-1.5 rounded-full bg-tint py-1 pl-1 pr-3 text-sm text-navy">
              {photos[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/photo/${photos[i]}`} alt="" width={28} height={28} loading="lazy" decoding="async" className="h-7 w-7 flex-none rounded-full border border-white bg-white object-cover" />
              ) : (
                <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full bg-white font-serif text-xs text-navy">{Array.from(n)[0] ?? ""}</span>
              )}
              <span>{n}</span>
            </li>
          ))}
          {rest > 0 && <li className="rounded-full border border-line px-3 py-1 text-sm text-soft">ほか {rest}人</li>}
        </ul>
      )}
    </div>
  );
}
