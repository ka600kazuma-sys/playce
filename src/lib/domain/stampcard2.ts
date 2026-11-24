// 周回つきスタンプカードの計算(画面・保存に依存しない純粋関数)。
// 1周=5ポイント。到達ごとに特典(クーポン)を発行し、5到達で次の周へ。超過分は次の周へ繰り越す。
// 奇数周: 3pt=100円引き / 5pt=200円引き。偶数周: 3pt=200円引き / 5pt=参加費1回無料。額は管理者設定で変更可。
export const LAP_SIZE = 5;
export type Reward = { kind: "discount"; yen: number } | { kind: "free" };
export type LapRewards = { odd: { 3: Reward; 5: Reward }; even: { 3: Reward; 5: Reward } };
export const DEFAULT_LAP_REWARDS: LapRewards = {
  odd: { 3: { kind: "discount", yen: 100 }, 5: { kind: "discount", yen: 200 } },
  even: { 3: { kind: "discount", yen: 200 }, 5: { kind: "free" } },
};
// lap は1始まり、points は周内の 0〜4。
export type CardState = { lap: number; points: number };
export type Issued = { lap: number; threshold: 3 | 5; reward: Reward };

export const MULTIPLIERS = [1, 2, 3] as const;
export const parseMultiplier = (v: unknown): 1 | 2 | 3 => (v === 2 || v === 3 ? v : 1);
export const lapParity = (lap: number): "odd" | "even" => (lap % 2 === 1 ? "odd" : "even");
export const totalOf = (s: CardState) => (s.lap - 1) * LAP_SIZE + s.points;
export const stateOf = (total: number): CardState => {
  const t = Math.max(0, Math.floor(total));
  return { lap: Math.floor(t / LAP_SIZE) + 1, points: t % LAP_SIZE };
};
// 次の特典までの必要ポイント(周内の 3 または 5 まで)。
export const pointsToNextReward = (s: CardState) => (s.points < 3 ? 3 - s.points : LAP_SIZE - s.points);

// n ポイント加算。跨いだ特典を漏れなく列挙する。
export function addPoints(s: CardState, n: number, rewards: LapRewards = DEFAULT_LAP_REWARDS): { state: CardState; issued: Issued[] } {
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new RangeError("invalid points");
  let { lap, points } = s;
  const issued: Issued[] = [];
  for (let i = 0; i < n; i++) {
    points++;
    if (points === 3) issued.push({ lap, threshold: 3, reward: rewards[lapParity(lap)][3] });
    if (points === LAP_SIZE) {
      issued.push({ lap, threshold: 5, reward: rewards[lapParity(lap)][5] });
      lap++; points = 0;
    }
  }
  return { state: { lap, points }, issued };
}

// 取り消し: 取り消し後の状態と、「到達条件を満たさなくなる発行済みクーポン」を返す(自動で取り消さず管理者に警告する)。
export function revokePoints(s: CardState, n: number, issuedCoupons: (Issued & { used: boolean })[]): { state: CardState; floor: boolean; affected: (Issued & { used: boolean })[] } {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("invalid points");
  const total = totalOf(s), after = Math.max(0, total - n);
  const state = stateOf(after);
  // 今回の取り消しで新たに条件を割り込むものだけ(以前の取り消しで割り込み済みのものは、再び警告しない)。
  const affected = issuedCoupons.filter((c) => { const at = (c.lap - 1) * LAP_SIZE + c.threshold; return at > after && at <= total; });
  return { state, floor: n > total, affected };
}

// ---- 保存データとの橋渡し ----
// 旧カード(lap なし・points 0〜5)は、points を累計とみなし lap=1 起点で読む(旧の「5の次は1」と、将来の動きは同じ)。
// 移行方法は未確定(指示書§14)のため、これは暫定。管理者が補正できる。
export function cardStateOf(d: { lap?: unknown; points?: unknown } | undefined): CardState {
  const p = Number.isInteger(d?.points) ? Math.min(Math.max(d!.points as number, 0), LAP_SIZE) : 0;
  if (Number.isInteger(d?.lap) && (d!.lap as number) >= 1 && p < LAP_SIZE) return { lap: d!.lap as number, points: p };
  if (Number.isInteger(d?.lap) && (d!.lap as number) >= 1) return stateOf((d!.lap as number - 1) * LAP_SIZE + p);
  return stateOf(p);
}

const isReward = (r: unknown): r is Reward => {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return o.kind === "free" || (o.kind === "discount" && Number.isInteger(o.yen) && (o.yen as number) >= 0 && (o.yen as number) <= 100_000);
};
export function parseLapRewards(input: unknown): LapRewards | null {
  if (typeof input !== "object" || input === null) return null;
  const out: Partial<LapRewards> = {};
  for (const par of ["odd", "even"] as const) {
    const t = (input as Record<string, unknown>)[par] as Record<string, unknown> | undefined;
    if (!t || !isReward(t["3"]) || !isReward(t["5"])) return null;
    out[par] = { 3: t["3"], 5: t["5"] };
  }
  return out as LapRewards;
}

export type CouponPlan = { id: string; lap: number; threshold: 3 | 5; reward: Reward };
// ポイントの付与計画。sourceKey は付与の元(イベント+会員、管理者操作のID など)。クーポンIDは sourceKey+周+段階で決まるため、再送しても同じIDで1回しか作れない。
export function planAward(doc: { lap?: unknown; points?: unknown } | undefined, add: number, sourceKey: string, rewards: LapRewards = DEFAULT_LAP_REWARDS) {
  const before = cardStateOf(doc);
  const r = addPoints(before, add, rewards);
  return {
    before, after: r.state,
    coupons: r.issued.map((i): CouponPlan => ({ id: `${sourceKey}_${i.lap}_${i.threshold}`, lap: i.lap, threshold: i.threshold, reward: i.reward })),
  };
}
