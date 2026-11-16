"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/member";
import { isStampSport } from "@/lib/domain/stamps";
import { setEnabled } from "@/lib/repo/stamps";

// スタンプカードのON/OFF。対象は、ログイン中の本人だけ(メンバーIDはセッションから取る)。
export async function toggleStampAction(fd: FormData) {
  const m = await requireMember("/stamp/settings");
  const sport = String(fd.get("sport") ?? ""), enabled = String(fd.get("enabled") ?? "") === "1";
  if (!isStampSport(sport)) redirect("/stamp/settings");
  let ok = false;
  try { ok = await setEnabled(m.id, sport, enabled); } catch { ok = false; }
  revalidatePath("/stamp"); revalidatePath("/stamp/settings");
  redirect(ok ? "/stamp/settings" : "/stamp/settings?err=1");
}
