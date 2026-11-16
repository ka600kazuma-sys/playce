import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/firebase/admin";
import { mapUrlProblem, venueHref, venueKey, venueNameProblem } from "@/lib/domain/venues";

// 会場の地図リンク(登録分)。venues/{ID} = { name, key, mapUrl, createdAt, updatedAt, updatedBy }。IDは会場名のキーのハッシュ。
// 公開してよい情報(会場名と地図のURL)だけ。読み書きはサーバー(Admin SDK)経由のみ。書き込みは主催者専用(呼び出し側で requireAdmin() を済ませること)。
const col = () => db().collection("venues");
const idOf = (name: string) => createHash("sha256").update(venueKey(name)).digest("hex").slice(0, 24);

export type VenueRow = { id: string; name: string; mapUrl: string };

export async function listVenues(): Promise<VenueRow[]> {
  const snap = await col().get();
  return snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? ""), mapUrl: String(d.data().mapUrl ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

// 画面用: 会場名(イベントの「場所」の文字列)ごとのリンク。登録を読めなくても、カレンダーは壊さず、検索リンクにする。
export async function venueLinks(names: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(names)];
  let registry: Record<string, string> = {};
  try { registry = Object.fromEntries((await listVenues()).map((v) => [venueKey(v.name), v.mapUrl])); } catch { registry = {}; }
  return Object.fromEntries(unique.map((n) => [n, venueHref(n, registry).href]));
}

export type SetResult = { ok: true } | { ok: false; message: string };
// 登録・更新(同じ会場名なら上書き)。URLは、Googleマップのものだけ。
export async function setVenue(name: string, mapUrl: string, by: string): Promise<SetResult> {
  const n = name.trim().normalize("NFKC"), np = venueNameProblem(n); if (np) return { ok: false, message: np };
  const url = mapUrl.trim(), up = mapUrlProblem(url); if (up) return { ok: false, message: up };
  const ref = col().doc(idOf(n)), now = Date.now();
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) tx.update(ref, { name: n, key: venueKey(n), mapUrl: url, updatedAt: now, updatedBy: by });
    else tx.create(ref, { name: n, key: venueKey(n), mapUrl: url, createdAt: now, updatedAt: now, updatedBy: by });
    tx.set(ref.collection("history").doc(), { at: now, by, action: s.exists ? "update" : "create", mapUrl: url });
  });
  return { ok: true };
}

export async function deleteVenue(id: string, by: string): Promise<boolean> {
  if (!/^[a-f0-9]{24}$/.test(id)) return false;
  const ref = col().doc(id);
  const s = await ref.get();
  if (!s.exists) return false;
  await ref.collection("history").doc().set({ at: Date.now(), by, action: "delete", name: s.data()?.name ?? "" });
  await ref.delete();
  return true;
}
