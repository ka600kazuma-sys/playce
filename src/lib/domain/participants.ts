// 公開する「参加表明」の一覧(誰でも見られる)。出してよいのは、参加が確定した申込の代表者のニックネームだけ。
// 同行者の名前・キャンセル待ち・取消済み・トークン・ブラウザ識別・金額は出さない。主催者が隠した人の名前は出さない(人数には含める)。
export type PartRow = { nickname: string; partySize: number; status: string; publicHidden?: boolean; createdAt: number };
export type PublicParticipants = { names: string[]; total: number };

export function toPublicParticipants(rows: PartRow[]): PublicParticipants {
  const confirmed = rows.filter((r) => r.status === "confirmed").sort((a, b) => a.createdAt - b.createdAt);
  return {
    names: confirmed.filter((r) => r.publicHidden !== true).map((r) => r.nickname),
    total: confirmed.reduce((n, r) => n + r.partySize, 0),
  };
}
