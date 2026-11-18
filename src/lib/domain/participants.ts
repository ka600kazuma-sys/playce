// 公開する「参加表明」の一覧(誰でも見られる)。出してよいのは、参加が確定した申込の代表者のニックネームだけ。
// 同行者の名前・キャンセル待ち・取消済み・トークン・ブラウザ識別・金額は出さない。主催者が隠した人の名前は出さない(人数には含める)。
export type PartRow = { nickname: string; partySize: number; status: string; publicHidden?: boolean; createdAt: number; photoKey?: string | null };
// photos は names と同じ順の、公開用の写真キー(写真を出すと本人が選んだ人だけ。いなければ null)。キーからメンバーは分からない。
export type PublicParticipants = { names: string[]; total: number; photos: (string | null)[] };

export function toPublicParticipants(rows: PartRow[]): PublicParticipants {
  const confirmed = rows.filter((r) => r.status === "confirmed").sort((a, b) => a.createdAt - b.createdAt);
  const shown = confirmed.filter((r) => r.publicHidden !== true); // 隠した人は、名前も写真も出さない(人数には含める)
  return {
    names: shown.map((r) => r.nickname),
    total: confirmed.reduce((n, r) => n + r.partySize, 0),
    photos: shown.map((r) => (typeof r.photoKey === "string" && /^[A-Za-z0-9_-]{22}$/.test(r.photoKey) ? r.photoKey : null)),
  };
}
