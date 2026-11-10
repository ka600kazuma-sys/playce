import type { PublicParticipants } from "@/lib/domain/participants";

// 参加表明の一覧(公開)。代表者のニックネームだけを表示し、同行者・非表示の人は人数にだけ含める。
export function ParticipantList({ p }: { p: PublicParticipants | undefined }) {
  const total = p?.total ?? 0;
  const names = p?.names ?? [];
  const rest = total - names.length;
  return (
    <div className="grid gap-1.5" aria-label="参加表明">
      <p className="text-[15px] font-semibold">参加表明 {total}人</p>
      {total === 0 ? <p className="text-sm text-soft">まだ参加表明はありません。</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((n, i) => <li key={`${i}-${n}`} className="rounded-full bg-tint px-3 py-1 text-sm text-navy">{n}</li>)}
          {rest > 0 && <li className="rounded-full border border-line px-3 py-1 text-sm text-soft">ほか {rest}人</li>}
        </ul>
      )}
    </div>
  );
}
