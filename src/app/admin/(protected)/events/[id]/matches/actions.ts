"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import type { Match } from "@/lib/domain/matchmaking";
import { getSettings, publishDraft, regenerateDraft, saveDraft, saveSettings, syncNumbers } from "@/lib/repo/matches";

// 試合管理の Server Action。必ず requireAdmin() で始める(画面を隠すだけでは保護にならない)。
const enc = encodeURIComponent;
const back = (id: string, q: string): never => redirect(`/admin/events/${id}/matches?${q}`);
const err = (id: string, m: string): never => back(id, `err=${enc(m.slice(0, 900))}`);
const int = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? NaN : Number(v); };
const FAIL = "処理できませんでした。時間をおいて再度お試しください。";

export async function saveSettingsAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  let r;
  try { r = await saveSettings(id, { sport: String(fd.get("sport") ?? ""), courts: int(fd, "courts"), teamSize: int(fd, "teamSize"), teams: int(fd, "teams"), perPlayer: int(fd, "perPlayer") }, admin.email); } catch { return err(id, FAIL); }
  if (!r.ok) return err(id, r.message);
  back(id, "ok=settings");
}

// 参加番号を今すぐ配布(開始1時間前を待たずに実行する場合)。配布済みなら新しい参加者の番号だけを追加する。
export async function distributeNowAction(id: string) {
  await requireAdmin();
  try { await syncNumbers(id, { force: true }); } catch { return err(id, FAIL); }
  back(id, "ok=numbers");
}

// 組み合わせの(再)生成。keepUpTo に「実施済みの試合番号(1〜N)」を指定すると、その試合は保持して残りだけ作り直す。
export async function generateAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const raw = String(fd.get("keepUpTo") ?? "").trim();
  const keep = raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(keep) || keep < 0 || keep > 500) return err(id, "実施済みの試合番号は、0以上の整数で入力してください。");
  let r;
  try { r = await regenerateDraft(id, admin.email, keep); } catch { return err(id, FAIL); }
  if (!r.ok) return err(id, `${r.reason}${r.alternatives.length ? ` 代替案: ${r.alternatives.join(" / ")}` : ""}`);
  back(id, `ok=generated${r.warnings.length ? `&warn=${enc(r.warnings.join(" "))}` : ""}`);
}

// 手動修正の保存。fields: n(行数), r_i(時間帯), c_i(コート), t_i_k_j(チームkのj番目の参加番号)。時間帯が空の行は削除、すべて空の追加行は無視する。
export async function saveDraftAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const st = await getSettings(id).catch(() => null);
  if (!st) return err(id, "先に設定を保存してください。");
  const n = Math.min(500, int(fd, "n") || 0), matches: Match[] = [];
  for (let i = 0; i < n; i++) {
    const round = int(fd, `r_${i}`), court = int(fd, `c_${i}`);
    const teams: number[][] = Array.from({ length: st.teams }, (_, k) => Array.from({ length: st.teamSize }, (_, j) => int(fd, `t_${i}_${k}_${j}`)));
    const nums = teams.flat();
    if (Number.isNaN(round) && Number.isNaN(court) && nums.every(Number.isNaN)) continue; // 空行(削除・未使用の追加行)
    if (Number.isNaN(round) || Number.isNaN(court) || nums.some(Number.isNaN)) return err(id, `${i + 1}行目: 時間帯・コート・参加番号をすべて入力してください(削除する場合はすべて空にします)。`);
    matches.push({ no: i + 1, round, court, teams });
  }
  if (matches.length === 0) return err(id, "試合が1件もありません。");
  let r;
  try { r = await saveDraft(id, matches, admin.email); } catch { return err(id, FAIL); }
  if (!r.ok) return err(id, `矛盾があるため保存できませんでした: ${r.errors.join(" / ")}`);
  back(id, `ok=saved${r.warnings.length ? `&warn=${enc(r.warnings.join(" "))}` : ""}`);
}

export async function publishAction(id: string) {
  const admin = await requireAdmin();
  let r;
  try { r = await publishDraft(id, admin.email); } catch { return err(id, FAIL); }
  if (r === "no_draft") return err(id, "公開する下書きがありません。先に組み合わせを生成してください。");
  back(id, "ok=published");
}
