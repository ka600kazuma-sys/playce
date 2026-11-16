"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { STAMP_SPORTS } from "@/lib/domain/stamps";
import { bumpTagVersion, setTiers } from "@/lib/repo/stamps";

const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || "NaN");

// 割引額の変更。金額はサーバーで検証する(整数・0以上・上限あり)。変更の履歴は stampConfig/default/history に残る。
export async function saveTiersAction(fd: FormData) {
  const admin = await requireAdmin();
  const input = Object.fromEntries(STAMP_SPORTS.map((s) => [s, { 3: num(fd.get(`${s}_3`)), 5: num(fd.get(`${s}_5`)) }]));
  let r: "ok" | "invalid" | "error";
  try { r = await setTiers(input, admin.email); } catch { r = "error"; }
  redirect(r === "ok" ? "/admin/stamp?ok=1" : `/admin/stamp?err=${r === "invalid" ? "1" : "2"}`);
}

// タグURLの再発行。古いURL・すでに書き込んだタグは使えなくなる(確認のチェックが必要)。
export async function reissueTagAction(eventId: string, fd: FormData) {
  const admin = await requireAdmin();
  if (fd.get("confirm") !== "on") redirect("/admin/stamp?err=3");
  let v: number | null = null;
  try { v = await bumpTagVersion(eventId, admin.email); } catch { v = null; }
  redirect(v ? "/admin/stamp?ok=2" : "/admin/stamp?err=2");
}
