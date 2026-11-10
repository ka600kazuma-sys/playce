// マイページの集計(純粋関数)。参加履歴・累計参加回数は、実際に出席確認された(当日受付済みの)イベントだけを数える。
export type MyReg = { status: string; attended: boolean; event: { id: string; title: string; startAt: string } };

const live = (r: MyReg) => r.status === "confirmed" || r.status === "waitlisted" || r.status === "offered";

// 参加予定: 開始前で、取消・期限切れでない申込。開始が近い順。
export const upcomingOf = (regs: MyReg[], now: Date) =>
  regs.filter((r) => live(r) && new Date(r.event.startAt).getTime() > now.getTime()).sort((a, b) => a.event.startAt.localeCompare(b.event.startAt));

// 参加履歴: 出席確認されたものだけ。新しい順。
export const historyOf = (regs: MyReg[]) => regs.filter((r) => r.attended).sort((a, b) => b.event.startAt.localeCompare(a.event.startAt));

export const summarize = (regs: MyReg[], now: Date) => {
  const upcoming = upcomingOf(regs, now), history = historyOf(regs);
  return { upcoming, upcomingTop: upcoming.slice(0, 3), attendedCount: history.length, history };
};

// プロフィール画像(クライアントで 256px の JPEG に縮小して送る)。サーバーでも種類と大きさを検証する。
export const AVATAR_MAX_BYTES = 150 * 1024;
export const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
