import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/firebase/admin";
import { eventSchema } from "@/lib/domain/events";
import { assignNew, distributeAt, mulberry32, slotsOf } from "@/lib/domain/numbers";
import { generate, renumber, settingsProblem, validateMatches, type GenResult, type Match, type Settings } from "@/lib/domain/matchmaking";

// 試合情報。events/{id}/matchPlan/{settings|numbering|draft|published}、events/{id}/players/{申込ID_枠番号}。
// 参加者に返してよいのは、公開版(published)の番号と組み合わせ、本人の参加番号だけ。下書き・氏名は主催者のみ(呼び出し側で requireAdmin() を済ませること)。
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const evRef = (id: string) => db().collection("events").doc(id);
const plan = (id: string) => evRef(id).collection("matchPlan");
const playersCol = (id: string) => evRef(id).collection("players");

type PlayerDoc = { number: number; regId: string; idx: number; label: string; memberId: string | null; active: boolean; createdAt: number };
type Draft = { matches: Match[]; version: number; updatedAt: number; origin: "auto" | "manual"; warnings: string[] };
type Published = { matches: Match[]; version: number; publishedAt: number; fromDraftVersion: number };

// ---- 参加番号 ----
export type SyncResult = { distributed: boolean; assigned: number; first: boolean };

// 番号の配布・追加。トランザクションで、同時・重複実行されても同じ番号を二重に発行しない(配布済みの枠は何もしない)。
// 開始1時間前になるまでは配布しない(force=主催者の手動実行を除く)。終了したイベントには、新たに配布しない。
export async function syncNumbers(eventId: string, opts: { force?: boolean; now?: number } = {}): Promise<SyncResult> {
  if (!validId(eventId)) return { distributed: false, assigned: 0, first: false };
  const now = opts.now ?? Date.now();
  return db().runTransaction(async (tx): Promise<SyncResult> => {
    const [evSnap, numSnap] = await Promise.all([tx.get(evRef(eventId)), tx.get(plan(eventId).doc("numbering"))]);
    const ev = evSnap.exists ? eventSchema.safeParse(evSnap.data()) : null;
    const num = numSnap.exists ? (numSnap.data() as { distributed?: boolean; max?: number }) : {};
    if (!ev || !ev.success || ev.data.status !== "published") return { distributed: num.distributed === true, assigned: 0, first: false };
    const first = num.distributed !== true;
    if (first && !opts.force && (now < distributeAt(ev.data.startAt) || now >= new Date(ev.data.endAt).getTime())) return { distributed: false, assigned: 0, first: false };
    if (!first && now >= new Date(ev.data.endAt).getTime() && !opts.force) return { distributed: true, assigned: 0, first: false };
    const [regsSnap, plSnap] = await Promise.all([tx.get(evRef(eventId).collection("registrations")), tx.get(playersCol(eventId))]);
    const slots = slotsOf(regsSnap.docs.map((d) => { const x = d.data() as { status: string; nickname: string; members?: string[]; memberId?: string }; return { id: d.id, status: x.status, nickname: x.nickname, members: x.members ?? [], memberId: x.memberId ?? null }; }));
    const existing = new Map<string, number>(), docs = new Map<string, PlayerDoc>();
    let max = num.max ?? 0;
    for (const d of plSnap.docs) { const p = d.data() as PlayerDoc; existing.set(d.id, p.number); docs.set(d.id, p); max = Math.max(max, p.number); }
    const { assigned, max: newMax } = assignNew(slots, existing, max, mulberry32(randomInt(1, 2 ** 31 - 1)));
    const activeKeys = new Set(slots.map((s) => s.key));
    for (const s of slots) {
      const n = assigned.get(s.key);
      if (n !== undefined) tx.create(playersCol(eventId).doc(s.key), { number: n, regId: s.regId, idx: s.idx, label: s.label, memberId: s.memberId, active: true, createdAt: now } satisfies PlayerDoc);
    }
    for (const [key, p] of docs) { // キャンセル・取消した人は inactive(番号は欠番のまま保持)。戻った場合・表示名の変更は反映する
      const s = slots.find((x) => x.key === key), active = activeKeys.has(key);
      if (p.active !== active || (s && (s.label !== p.label || s.memberId !== p.memberId))) tx.update(playersCol(eventId).doc(key), { active, ...(s ? { label: s.label, memberId: s.memberId } : {}) });
    }
    if (first) tx.set(plan(eventId).doc("numbering"), { distributed: true, max: newMax, distributedAt: now, by: opts.force ? "admin" : "auto" });
    else if (newMax !== (num.max ?? 0)) tx.update(plan(eventId).doc("numbering"), { max: newMax });
    return { distributed: true, assigned: assigned.size, first };
  });
}

// 画面の表示時に呼ぶ入口(Cloud Scheduler を使わない「アクセス時の遅延実行」)。配布の時刻を過ぎていれば配布し、初回なら下書きを自動生成する。
export async function ensureNumbers(eventId: string): Promise<void> {
  try {
    const r = await syncNumbers(eventId);
    if (r.first && r.distributed) await autoGenerate(eventId);
  } catch (e) { console.error("ensureNumbers", e instanceof Error ? e.message : e); }
}

export type MyNumber = { number: number; label: string; isSelf: boolean; active: boolean };
export async function getMyNumbers(eventId: string, memberId: string): Promise<{ distributed: boolean; numbers: MyNumber[] }> {
  if (!validId(eventId) || !validId(memberId)) return { distributed: false, numbers: [] };
  const [num, snap] = await Promise.all([plan(eventId).doc("numbering").get(), playersCol(eventId).where("memberId", "==", memberId).get()]);
  const numbers = snap.docs.map((d) => d.data() as PlayerDoc).filter((p) => p.active).sort((a, b) => a.idx - b.idx || a.number - b.number)
    .map((p) => ({ number: p.number, label: p.label, isSelf: p.idx === 0, active: p.active }));
  return { distributed: num.exists && (num.data() as { distributed?: boolean }).distributed === true, numbers };
}

// ---- 設定・下書き・公開 ----
const activeNumbers = async (eventId: string) => {
  const snap = await playersCol(eventId).get();
  const all = new Set<number>(), active = new Set<number>();
  for (const d of snap.docs) { const p = d.data() as PlayerDoc; all.add(p.number); if (p.active) active.add(p.number); }
  return { all, active };
};

export async function getSettings(eventId: string): Promise<Settings | null> {
  if (!validId(eventId)) return null;
  const s = await plan(eventId).doc("settings").get();
  return s.exists ? (s.data() as Settings) : null;
}
export async function saveSettings(eventId: string, st: Settings, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!validId(eventId)) return { ok: false, message: "イベントが見つかりません" };
  const p = settingsProblem(st); if (p) return { ok: false, message: p };
  await plan(eventId).doc("settings").set({ sport: st.sport.trim(), courts: st.courts, teamSize: st.teamSize, teams: st.teams, perPlayer: st.perPlayer });
  await evRef(eventId).collection("audit").add({ at: Date.now(), by, action: "match_settings" });
  return { ok: true };
}

const saveDraftDoc = (eventId: string, r: GenResult, origin: "auto" | "manual", tx?: FirebaseFirestore.Transaction, prev = 0) => {
  const doc: Draft = { matches: r.matches, version: prev + 1, updatedAt: Date.now(), origin, warnings: r.warnings };
  if (tx) tx.set(plan(eventId).doc("draft"), doc); else return plan(eventId).doc("draft").set(doc);
};

// 配布と同時の自動生成。設定済みで、下書き・公開版がまだ無いときだけ作る(二重生成しない)。
async function autoGenerate(eventId: string): Promise<void> {
  const st = await getSettings(eventId); if (!st) return;
  const nums = await activeNumbers(eventId);
  const r = generate({ players: [...nums.active], settings: st, seed: randomInt(1, 2 ** 31 - 1) });
  if (!r.ok) return;
  await db().runTransaction(async (tx) => {
    const d = await tx.get(plan(eventId).doc("draft"));
    if (!d.exists) saveDraftDoc(eventId, r, "auto", tx);
  });
}

export type GenOutcome = { ok: true; warnings: string[]; stats: GenResult["stats"] } | { ok: false; reason: string; alternatives: string[] };
// 主催者による(再)生成。keepUpTo>0 のとき、試合1〜keepUpTo は実施済みとして保持し、残りだけ現在の参加人数で作り直す。
export async function regenerateDraft(eventId: string, by: string, keepUpTo = 0): Promise<GenOutcome> {
  if (!validId(eventId)) return { ok: false, reason: "イベントが見つかりません", alternatives: [] };
  const st = await getSettings(eventId);
  if (!st) return { ok: false, reason: "先に、競技・コート数・チーム人数・希望試合数を保存してください。", alternatives: [] };
  const nums = await activeNumbers(eventId);
  if (nums.active.size === 0) return { ok: false, reason: "参加番号がまだ配布されていません(または参加者がいません)。", alternatives: ["「今すぐ番号を配布」を押す"] };
  const [d, p] = await Promise.all([plan(eventId).doc("draft").get(), plan(eventId).doc("published").get()]);
  const base = d.exists ? (d.data() as Draft).matches : p.exists ? (p.data() as Published).matches : [];
  const fixed = keepUpTo > 0 ? base.filter((m) => m.no <= keepUpTo) : [];
  const r = generate({ players: [...nums.active], settings: st, fixed, seed: randomInt(1, 2 ** 31 - 1) });
  if (!r.ok) return { ok: false, reason: r.reason ?? "生成できませんでした", alternatives: r.alternatives ?? [] };
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(plan(eventId).doc("draft"));
    saveDraftDoc(eventId, r, "auto", tx, cur.exists ? (cur.data() as Draft).version : 0);
    tx.set(evRef(eventId).collection("audit").doc(), { at: Date.now(), by, action: keepUpTo > 0 ? `match_regenerate_from_${keepUpTo + 1}` : "match_generate" });
  });
  return { ok: true, warnings: r.warnings, stats: r.stats };
}

// 手動修正の保存。矛盾(同時出場・コート重複・人数違い・存在しない番号)があれば保存しない。
export async function saveDraft(eventId: string, matches: Match[], by: string): Promise<{ ok: true; warnings: string[] } | { ok: false; errors: string[] }> {
  const st = await getSettings(eventId);
  if (!st) return { ok: false, errors: ["設定が保存されていません"] };
  const v = validateMatches(matches, st, await activeNumbers(eventId));
  if (v.errors.length) return { ok: false, errors: v.errors };
  const sorted = renumber(matches);
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(plan(eventId).doc("draft"));
    saveDraftDoc(eventId, { ok: true, matches: sorted, warnings: v.warnings }, "manual", tx, cur.exists ? (cur.data() as Draft).version : 0);
    tx.set(evRef(eventId).collection("audit").doc(), { at: Date.now(), by, action: "match_edit" });
  });
  return { ok: true, warnings: v.warnings };
}

// 公開 / 変更を公開。下書きの最新版を、公開版へ一括で置き換える。編集途中の下書きは公開されない。
export async function publishDraft(eventId: string, by: string): Promise<"ok" | "no_draft"> {
  if (!validId(eventId)) return "no_draft";
  return db().runTransaction(async (tx) => {
    const [d, p] = await Promise.all([tx.get(plan(eventId).doc("draft")), tx.get(plan(eventId).doc("published"))]);
    if (!d.exists) return "no_draft";
    const draft = d.data() as Draft;
    tx.set(plan(eventId).doc("published"), { matches: draft.matches, version: p.exists ? (p.data() as Published).version + 1 : 1, publishedAt: Date.now(), fromDraftVersion: draft.version } satisfies Published);
    tx.set(evRef(eventId).collection("audit").doc(), { at: Date.now(), by, action: "match_publish" });
    return "ok";
  });
}

// ---- 参加者向け(公開版だけ) ----
export type PublicPlan = { matches: Match[]; version: number; publishedAt: number };
export async function getPublicPlan(eventId: string): Promise<PublicPlan | null> {
  if (!validId(eventId)) return null;
  const s = await plan(eventId).doc("published").get();
  if (!s.exists) return null;
  const p = s.data() as Published;
  return { matches: p.matches, version: p.version, publishedAt: p.publishedAt };
}

// ---- 主催者向け ----
export type AdminPlan = {
  settings: Settings | null; distributed: boolean;
  players: { number: number; label: string; active: boolean; regId: string; idx: number }[];
  draft: Draft | null; published: Published | null; dirty: boolean;
};
export async function getAdminPlan(eventId: string): Promise<AdminPlan> {
  const [settings, num, pl, d, p] = await Promise.all([getSettings(eventId), plan(eventId).doc("numbering").get(), playersCol(eventId).get(), plan(eventId).doc("draft").get(), plan(eventId).doc("published").get()]);
  const draft = d.exists ? (d.data() as Draft) : null, published = p.exists ? (p.data() as Published) : null;
  return {
    settings, distributed: num.exists && (num.data() as { distributed?: boolean }).distributed === true,
    players: pl.docs.map((x) => x.data() as PlayerDoc).sort((a, b) => a.number - b.number).map((x) => ({ number: x.number, label: x.label, active: x.active, regId: x.regId, idx: x.idx })),
    draft, published, dirty: !!draft && (!published || published.fromDraftVersion !== draft.version),
  };
}
