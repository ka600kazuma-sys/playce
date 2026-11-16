"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { deleteVenue, setVenue } from "@/lib/repo/venues";

const back = (q: string): never => redirect(`/admin/venues${q}`);

// 会場の地図リンクの登録・更新。名前と、GoogleマップのURLはサーバーで検証する。
export async function saveVenueAction(fd: FormData) {
  const admin = await requireAdmin();
  let r: Awaited<ReturnType<typeof setVenue>> | null = null;
  try { r = await setVenue(String(fd.get("name") ?? ""), String(fd.get("mapUrl") ?? ""), admin.email); } catch { r = null; }
  if (!r) return back("?err=" + encodeURIComponent("処理できませんでした。時間をおいて、もう一度お試しください。"));
  return back(r.ok ? "?ok=1" : "?err=" + encodeURIComponent(r.message));
}

// 登録の削除(削除すると、その会場は、会場名でのGoogleマップ検索リンクに戻る)。
export async function deleteVenueAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  if (fd.get("confirm") !== "on") return back("?err=" + encodeURIComponent("削除の確認にチェックを入れてください。"));
  let ok = false;
  try { ok = await deleteVenue(id, admin.email); } catch { ok = false; }
  return back(ok ? "?ok=2" : "?err=" + encodeURIComponent("削除できませんでした。"));
}
