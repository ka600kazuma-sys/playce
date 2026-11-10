import test from "node:test";
import assert from "node:assert/strict";
import { generate, validateMatches, settingsProblem, renumber } from "../src/lib/domain/matchmaking.ts";
import { assignNew, slotsOf } from "../src/lib/domain/numbers.ts";
import { mulberry32, dueForNumbers, distributeAt } from "../src/lib/domain/numbers.ts";

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const dbl = { sport: "バドミントン", courts: 2, teamSize: 2, teams: 2, perPlayer: 4 };

test("参加番号: 初回は1番から人数分をランダムに重複なく。同じ入力でも配布済みなら変わらない", () => {
  const regs = [{ id: "a", status: "confirmed", nickname: "A", members: ["A2", "A3"] }, { id: "b", status: "confirmed", nickname: "B", members: [] }, { id: "c", status: "waitlisted", nickname: "C", members: [] }, { id: "d", status: "cancelled", nickname: "D", members: [] }];
  const slots = slotsOf(regs);
  assert.equal(slots.length, 4); // 確定のみ(代表者+同行者)
  const r1 = assignNew(slots, new Map(), 0, mulberry32(1));
  assert.deepEqual([...r1.assigned.values()].sort((a, b) => a - b), [1, 2, 3, 4]); assert.equal(r1.max, 4);
  const existing = new Map(r1.assigned);
  const r2 = assignNew(slots, existing, r1.max, mulberry32(99));
  assert.equal(r2.assigned.size, 0, "二重実行しても新しい番号は発行されない");
});
test("参加番号: 途中参加は未使用の新しい番号。キャンセルの番号(欠番)は再利用しない", () => {
  const existing = new Map([["a_0", 2], ["b_0", 1], ["c_0", 3]]); // b がキャンセル=番号1は欠番、max=3 のまま
  const slots = slotsOf([{ id: "a", status: "confirmed", nickname: "A", members: [] }, { id: "e", status: "confirmed", nickname: "E", members: [] }, { id: "f", status: "confirmed", nickname: "F", members: [] }]);
  const r = assignNew(slots, existing, 3, mulberry32(5));
  assert.deepEqual([...r.assigned.values()].sort(), [4, 5]); assert.ok(![...r.assigned.values()].includes(1));
});

for (const [name, P, st] of [
  ["ダブルス 16人 2コート 4試合", 16, dbl], ["ダブルス 13人(端数)", 13, dbl], ["シングルス 9人 3コート", 9, { sport: "卓球", courts: 3, teamSize: 1, teams: 2, perPlayer: 5 }],
  ["バレー6人制 24人 2コート", 24, { sport: "バレー", courts: 2, teamSize: 6, teams: 2, perPlayer: 3 }], ["ダブルス 7人 コート多め", 7, { ...dbl, courts: 4 }],
]) {
  test(`生成: ${name} — 全員ほぼ均等・同時出場なし・検証を通る`, () => {
    const players = range(P), r = generate({ players, settings: st, seed: 7 });
    assert.ok(r.ok);
    const v = validateMatches(r.matches, st, { all: new Set(players), active: new Set(players) });
    assert.deepEqual(v.errors, []);
    assert.ok(r.stats.maxPlayed - r.stats.minPlayed <= 1, `差=${r.stats.maxPlayed - r.stats.minPlayed}`);
    assert.ok(r.stats.minPlayed >= st.perPlayer - 0 || r.stats.maxPlayed >= st.perPlayer);
  });
}
test("生成: 結果は seed が同じなら同じ(再現可能)", () => {
  const a = generate({ players: range(12), settings: dbl, seed: 3 }), b = generate({ players: range(12), settings: dbl, seed: 3 });
  assert.deepEqual(a.matches, b.matches);
});
test("公平性: 16人・6試合で、同じペア・対戦相手・連続出場が、ランダム割り当て(平均: ペア8・対戦28・連続43)より大幅に少ない", () => {
  const players = range(16);
  let rp = 0, ro = 0, rb = 0; const N = 10;
  for (let seed = 1; seed <= N; seed++) { const r = generate({ players, settings: { ...dbl, perPlayer: 6 }, seed }); rp += r.stats.repeatPartners; ro += r.stats.repeatOpponents; rb += r.stats.back2back; assert.ok(r.stats.maxPlayed - r.stats.minPlayed <= 1); }
  assert.ok(rp / N <= 2, `ペア重複(平均)=${rp / N}`); assert.ok(ro / N <= 18, `対戦重複(平均)=${ro / N}`); assert.ok(rb / N <= 20, `連続出場(平均)=${rb / N}`);
});
test("生成できない場合は理由と代替案を返す(人数不足)", () => {
  const r = generate({ players: range(3), settings: dbl, seed: 1 });
  assert.equal(r.ok, false); assert.match(r.reason, /足りません/); assert.ok(r.alternatives.length >= 1);
});
test("人数が少なくコートを使い切れない場合は、警告して同時出場を避ける", () => {
  const r = generate({ players: range(5), settings: { ...dbl, courts: 3 }, seed: 1 });
  assert.ok(r.ok); assert.ok(r.warnings.some((w) => w.includes("コート")));
  assert.deepEqual(validateMatches(r.matches, { ...dbl, courts: 3 }, { all: new Set(range(5)), active: new Set(range(5)) }).errors, []);
});

test("検証: 同時間帯の二重出場・コート重複・存在しない番号・人数違いを検出する", () => {
  const nums = { all: new Set(range(8)), active: new Set(range(8)) };
  const ok = [{ no: 1, round: 1, court: 1, teams: [[1, 2], [3, 4]] }, { no: 2, round: 1, court: 2, teams: [[5, 6], [7, 8]] }];
  assert.deepEqual(validateMatches(ok, dbl, nums).errors, []);
  const dup = [{ no: 1, round: 1, court: 1, teams: [[1, 2], [3, 4]] }, { no: 2, round: 1, court: 2, teams: [[4, 6], [7, 8]] }];
  assert.ok(validateMatches(dup, dbl, nums).errors.some((e) => e.includes("同時")));
  assert.ok(validateMatches([{ ...ok[0] }, { ...ok[1], court: 1 }], dbl, nums).errors.some((e) => e.includes("重複")));
  assert.ok(validateMatches([{ no: 1, round: 1, court: 1, teams: [[1, 2], [3, 99]] }], dbl, nums).errors.some((e) => e.includes("99")));
  assert.ok(validateMatches([{ no: 1, round: 1, court: 1, teams: [[1], [3, 4]] }], dbl, nums).errors.some((e) => e.includes("人数")));
  assert.ok(validateMatches([{ no: 1, round: 1, court: 1, teams: [[1, 1], [3, 4]] }], dbl, nums).errors.some((e) => e.includes("2回")));
  assert.ok(validateMatches([{ no: 1, round: 1, court: 9, teams: [[1, 2], [3, 4]] }], dbl, nums).errors.some((e) => e.includes("コート")));
  const cancelled = validateMatches(ok, dbl, { all: new Set(range(8)), active: new Set(range(7)) });
  assert.deepEqual(cancelled.errors, []); assert.ok(cancelled.warnings.some((w) => w.includes("8")));
});

test("当日の人数変更: 実施済みの試合は保持し、残りだけを新しい人数で再生成。参加番号は変わらない", () => {
  const players = range(12), first = generate({ players, settings: dbl, seed: 2 });
  const done = first.matches.filter((m) => m.round <= 2);
  const now = [...range(12).filter((p) => p !== 5), 13, 14]; // 5番キャンセル、13・14番が途中参加
  const re = generate({ players: now, settings: dbl, fixed: done, seed: 4 });
  assert.ok(re.ok);
  assert.deepEqual(re.matches.slice(0, done.length), done, "実施済みは変更なし");
  const rest = re.matches.slice(done.length);
  assert.ok(rest.length > 0 && rest.every((m) => m.round > 2));
  assert.ok(rest.every((m) => m.teams.flat().every((p) => p !== 5)), "キャンセルした5番は残りの試合に入らない");
  assert.ok(rest.some((m) => m.teams.flat().some((p) => p >= 13)), "途中参加者も出場する");
  assert.deepEqual(validateMatches(re.matches, dbl, { all: new Set([...range(14)]), active: new Set(now) }).errors, []);
  const nums = re.matches.map((m) => m.no); assert.deepEqual(nums, nums.map((_, i) => i + 1));
});
test("設定の検証と試合番号の振り直し", () => {
  assert.equal(settingsProblem(dbl), null);
  for (const bad of [{ ...dbl, courts: 0 }, { ...dbl, teamSize: 12 }, { ...dbl, teams: 1 }, { ...dbl, perPlayer: 0 }, { ...dbl, sport: "" }]) assert.notEqual(settingsProblem(bad), null);
  const r = renumber([{ no: 9, round: 2, court: 1, teams: [] }, { no: 8, round: 1, court: 2, teams: [] }, { no: 7, round: 1, court: 1, teams: [] }]);
  assert.deepEqual(r.map((m) => [m.no, m.round, m.court]), [[1, 1, 1], [2, 1, 2], [3, 2, 1]]);
});

test("自動配布の対象: 公開中で、開始1時間前を過ぎ、終了前のイベントだけ", () => {
  const H = 3600e3, now = Date.parse("2026-11-10T12:00:00Z"), at = (ms) => new Date(now + ms).toISOString();
  const ev = (name, status, s, e) => ({ name, status, startAt: at(s), endAt: at(e) });
  const list = [ev("ちょうど1時間前", "published", H, 3 * H), ev("1時間より前", "published", H + 1000, 3 * H), ev("開催中", "published", -H, H), ev("終了済み", "published", -3 * H, -H),
    ev("中止", "cancelled", H, 3 * H), ev("非公開", "hidden", H, 3 * H)];
  assert.deepEqual(dueForNumbers(list, now).map((e) => e.name), ["ちょうど1時間前", "開催中"]);
  assert.equal(distributeAt(at(H)), now);
});
