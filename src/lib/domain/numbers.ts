// 参加番号(純粋関数)。番号はイベントごとに独立。一度配った番号は変えず、欠番(キャンセル)の番号は再発行しない。
export type Slot = { key: string; regId: string; idx: number; label: string; memberId: string | null };

// 申込(確定済み)から、番号を持つ「1人分の枠」を作る。idx=0 が代表者、1以上が同行者。
export function slotsOf(regs: { id: string; status: string; nickname: string; members: string[]; memberId?: string | null }[]): Slot[] {
  const out: Slot[] = [];
  for (const r of regs) {
    if (r.status !== "confirmed") continue;
    [r.nickname, ...(r.members ?? [])].forEach((label, idx) => out.push({ key: `${r.id}_${idx}`, regId: r.id, idx, label, memberId: r.memberId ?? null }));
  }
  return out;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 番号の割り当て。まだ番号のない枠だけを、ランダムな順に、これまでの最大番号の次から連番で割り当てる。
// 初回配布は max=0 なので「1番から人数分をランダムに割り当て」になり、途中参加者は未使用の新しい番号になる。
export function assignNew(active: Slot[], existing: Map<string, number>, max: number, rnd: () => number): { assigned: Map<string, number>; max: number } {
  const fresh = shuffle(active.filter((s) => !existing.has(s.key)), rnd);
  const assigned = new Map<string, number>();
  let m = max;
  for (const s of fresh) assigned.set(s.key, ++m);
  return { assigned, max: m };
}

// 開始1時間前(配布の開始時刻)。
export const DISTRIBUTE_BEFORE_MS = 60 * 60 * 1000;
export const distributeAt = (startAt: string) => new Date(startAt).getTime() - DISTRIBUTE_BEFORE_MS;

// 自動配布の対象: 公開中で、配布の時刻(開始1時間前)を過ぎ、まだ終了していないイベント。
export const dueForNumbers = <E extends { status: string; startAt: string; endAt: string }>(events: E[], now: number): E[] =>
  events.filter((e) => e.status === "published" && now >= distributeAt(e.startAt) && now < new Date(e.endAt).getTime());
