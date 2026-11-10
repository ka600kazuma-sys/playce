// 試合の組み合わせ生成・検証(純粋関数)。番号(参加番号)だけを扱い、個人情報は含めない。
import { mulberry32, shuffle } from "./numbers.ts";

export type Settings = { sport: string; courts: number; teamSize: number; teams: number; perPlayer: number };
export type Match = { no: number; round: number; court: number; teams: number[][] };
export type GenResult = {
  ok: boolean; matches: Match[]; warnings: string[]; reason?: string; alternatives?: string[];
  stats?: { minPlayed: number; maxPlayed: number; repeatPartners: number; repeatOpponents: number; back2back: number };
};

export const LIMITS = { courts: [1, 20], teamSize: [1, 11], teams: [2, 4], perPlayer: [1, 30] } as const;
export function settingsProblem(s: Settings): string | null {
  const bad = (k: keyof typeof LIMITS) => !Number.isInteger(s[k]) || s[k] < LIMITS[k][0] || s[k] > LIMITS[k][1];
  if (bad("courts")) return "コート数は1〜20で指定してください";
  if (bad("teamSize")) return "1チームの人数は1〜11で指定してください";
  if (bad("teams")) return "対戦チーム数は2〜4で指定してください";
  if (bad("perPlayer")) return "1人あたりの希望試合数は1〜30で指定してください";
  if (!s.sport.trim() || s.sport.length > 30) return "競技名を30文字以内で入力してください";
  return null;
}

const pk = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// 組み合わせの生成。fixed は実施済みの試合(変更しない)。残りだけを、出場回数・ペア・対戦・連続出場を考慮して作る。
export function generate(input: { players: number[]; settings: Settings; fixed?: Match[]; seed: number }): GenResult {
  const { settings: st } = input, fixed = input.fixed ?? [];
  const players = [...new Set(input.players)].sort((a, b) => a - b);
  const P = players.length, S = st.teamSize * st.teams, rnd = mulberry32(input.seed);
  const warnings: string[] = [];
  if (P < S) {
    return { ok: false, matches: fixed, warnings, reason: `参加者が${P}人で、1試合に必要な${S}人(${st.teamSize}人×${st.teams}チーム)に足りません。`,
      alternatives: [`1チームの人数または対戦チーム数を減らす(例: ${P >= 2 ? "シングルス" : "-"})`, `あと${S - P}人の参加を待つ`] };
  }
  const maxCourts = Math.floor(P / S);
  const courts = Math.min(st.courts, maxCourts);
  if (courts < st.courts) warnings.push(`人数が少ないため、同時に使えるコートは${courts}面です(設定は${st.courts}面)。`);

  const cnt = new Map<number, number>(), last = new Map<number, number>(), partner = new Map<string, number>(), opp = new Map<string, number>();
  for (const p of players) { cnt.set(p, 0); last.set(p, 0); }
  const bump = (m: Map<string, number>, a: number, b: number) => m.set(pk(a, b), (m.get(pk(a, b)) ?? 0) + 1);
  const record = (m: Match) => {
    for (const t of m.teams) { for (const p of t) { cnt.set(p, (cnt.get(p) ?? 0) + 1); last.set(p, Math.max(last.get(p) ?? 0, m.round)); }
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) bump(partner, t[i], t[j]); }
    for (let a = 0; a < m.teams.length; a++) for (let b = a + 1; b < m.teams.length; b++) for (const x of m.teams[a]) for (const y of m.teams[b]) bump(opp, x, y);
  };
  fixed.forEach(record);
  const remainingTotal = players.reduce((n, p) => n + Math.max(0, st.perPlayer - (cnt.get(p) ?? 0)), 0);
  const M = Math.ceil(remainingTotal / S);
  if (remainingTotal % S !== 0 && M > 0) warnings.push("人数と試合形式の都合で、全員を同じ試合数にできません。一部の方が1試合多くなります(差は最大1試合)。");

  const matches = [...fixed];
  let round = fixed.reduce((n, m) => Math.max(n, m.round), 0) + 1, no = fixed.reduce((n, m) => Math.max(n, m.no), 0), made = 0;
  while (made < M) {
    const c = Math.min(courts, M - made), need = c * S;
    // 出場回数が少ない人は必ず出場(forced)。境目の回数が同じ人(flexible)の中から、毎回ランダムに選び直して、
    // ペア・対戦の重複と連続出場の合計コストが最小の組み合わせを探す(回数の均等を最優先)。
    const sorted = [...players].sort((a, b) => cnt.get(a)! - cnt.get(b)!);
    const edge = cnt.get(sorted[need - 1])!;
    const forced = sorted.filter((p) => cnt.get(p)! < edge), flexible = sorted.filter((p) => cnt.get(p)! === edge);
    const trials = Math.max(60, Math.min(500, Math.floor(8000 / need)));
    let best: number[][][] | null = null, bestCost = Infinity;
    for (let t = 0; t < trials; t++) {
      const sh = shuffle([...forced, ...shuffle(flexible, rnd).slice(0, need - forced.length)], rnd), grid: number[][][] = [];
      let cost = 0;
      for (const p of sh) if (last.get(p) === round - 1 && round > 1) cost += 12; // 連続出場
      for (let m = 0; m < c; m++) {
        const teams: number[][] = [];
        for (let k = 0; k < st.teams; k++) teams.push(sh.slice(m * S + k * st.teamSize, m * S + (k + 1) * st.teamSize));
        for (const tm of teams) for (let i = 0; i < tm.length; i++) for (let j = i + 1; j < tm.length; j++) { const n = partner.get(pk(tm[i], tm[j])) ?? 0; cost += 10 * n * n + 3 * n; }
        for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) for (const x of teams[a]) for (const y of teams[b]) { const n = opp.get(pk(x, y)) ?? 0; cost += 5 * n * n + 2 * n; }
        grid.push(teams);
      }
      if (cost < bestCost) { bestCost = cost; best = grid; if (cost === 0) break; }
    }
    best!.forEach((teams, i) => { const m: Match = { no: ++no, round, court: i + 1, teams: teams.map((x) => [...x].sort((a, b) => a - b)) }; matches.push(m); record(m); });
    made += c; round++;
  }
  return { ok: true, matches, warnings, stats: statsOf(matches, players) };
}

export function statsOf(matches: Match[], players: number[]) {
  const cnt = new Map<number, number>(), partner = new Map<string, number>(), opp = new Map<string, number>(), rounds = new Map<number, Set<number>>();
  for (const p of players) cnt.set(p, 0);
  for (const m of matches) {
    for (const t of m.teams) for (const p of t) { cnt.set(p, (cnt.get(p) ?? 0) + 1); (rounds.get(p) ?? rounds.set(p, new Set()).get(p)!).add(m.round); }
    for (const t of m.teams) for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) partner.set(pk(t[i], t[j]), (partner.get(pk(t[i], t[j])) ?? 0) + 1);
    for (let a = 0; a < m.teams.length; a++) for (let b = a + 1; b < m.teams.length; b++) for (const x of m.teams[a]) for (const y of m.teams[b]) opp.set(pk(x, y), (opp.get(pk(x, y)) ?? 0) + 1);
  }
  const vals = [...cnt.values()];
  let back2back = 0; for (const rs of rounds.values()) for (const r of rs) if (rs.has(r + 1)) back2back++;
  const rep = (m: Map<string, number>) => [...m.values()].reduce((n, v) => n + Math.max(0, v - 1), 0);
  return { minPlayed: vals.length ? Math.min(...vals) : 0, maxPlayed: vals.length ? Math.max(...vals) : 0, repeatPartners: rep(partner), repeatOpponents: rep(opp), back2back };
}

// 主催者が手で直した内容の検証。errors があれば保存しない。warnings は注意として表示する。
export function validateMatches(matches: Match[], st: Settings, numbers: { all: Set<number>; active: Set<number> }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const roundPlayers = new Map<number, Map<number, number>>(), roundCourts = new Map<number, Set<number>>();
  for (const m of matches) {
    const tag = `試合${m.no}`;
    if (!Number.isInteger(m.round) || m.round < 1) { errors.push(`${tag}: 時間帯は1以上の整数にしてください`); continue; }
    if (!Number.isInteger(m.court) || m.court < 1 || m.court > st.courts) errors.push(`${tag}: コートは1〜${st.courts}で指定してください`);
    const cs = roundCourts.get(m.round) ?? roundCourts.set(m.round, new Set()).get(m.round)!;
    if (cs.has(m.court)) errors.push(`${tag}: 時間帯${m.round}のコート${m.court}に、試合が重複しています`); cs.add(m.court);
    if (m.teams.length !== st.teams) errors.push(`${tag}: チーム数が${st.teams}ではありません`);
    const inMatch = new Set<number>();
    for (const t of m.teams) {
      if (t.length !== st.teamSize) errors.push(`${tag}: 1チームの人数が${st.teamSize}人ではありません`);
      for (const p of t) {
        if (!Number.isInteger(p) || !input_has(numbers.all, p)) { errors.push(`${tag}: 参加番号${p}は存在しません`); continue; }
        if (!numbers.active.has(p)) warnings.push(`${tag}: 参加番号${p}はキャンセル済みです`);
        if (inMatch.has(p)) errors.push(`${tag}: 参加番号${p}が同じ試合に2回入っています`);
        inMatch.add(p);
        const rp = roundPlayers.get(m.round) ?? roundPlayers.set(m.round, new Map()).get(m.round)!;
        if (rp.has(p) && rp.get(p) !== m.no) errors.push(`参加番号${p}が、時間帯${m.round}に試合${rp.get(p)}と試合${m.no}へ同時に割り当てられています`);
        rp.set(p, m.no);
      }
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
const input_has = (s: Set<number>, p: number) => s.has(p);

// 試合番号の振り直し(時間帯→コートの順)。
export const renumber = (ms: Match[]): Match[] => [...ms].sort((a, b) => a.round - b.round || a.court - b.court).map((m, i) => ({ ...m, no: i + 1 }));
