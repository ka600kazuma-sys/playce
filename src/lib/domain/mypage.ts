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
export const AVATAR_MAX_DIM = 1024; // 縦横とも(クライアントは256で送る。大きな画素数の画像で、メモリを使わせない)
// JPEG の構造を、先頭から読んで、画像の大きさ(SOF)を取り出す。SOF が見つからない・壊れている・EOI で終わらないものは null。
export function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (!isJpeg(b) || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i++; // 詰め物
    const m = b[i + 1];
    if (m === 0xd9 || m === 0xda) return null; // 大きさの前にデータが始まった
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; } // 長さのないマーカー
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const sof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
    if (sof) { if (len < 8) return null; return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }; }
    i += 2 + len;
  }
  return null;
}
export const validAvatarJpeg = (b: Uint8Array) => { const s = jpegSize(b); return !!s && s.w >= 16 && s.h >= 16 && s.w <= AVATAR_MAX_DIM && s.h <= AVATAR_MAX_DIM; };
