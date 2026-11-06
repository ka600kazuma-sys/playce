"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { postBodySchema, THREAD_STATUS, type ThreadStatus } from "@/lib/domain/messages";
import { addOrganizerPost, setThreadStatus } from "@/lib/repo/messages";

// 管理用の Server Action は、必ず requireAdmin() で始める(画面を隠すだけでは保護にならない)。
const go = (id: string, q: string): never => redirect(`/admin/messages/${id}?${q}`);

export async function replyAsOrganizerAction(id: string, fd: FormData) {
  await requireAdmin();
  const parsed = postBodySchema.safeParse({ body: String(fd.get("body") ?? "") });
  if (!parsed.success) go(id, `err=${encodeURIComponent(parsed.error.issues[0].message)}`);
  let r;
  try { r = await addOrganizerPost(id, parsed.data!.body); } catch { r = "error" as const; }
  if (r === "ok") go(id, "sent=1");
  go(id, `err=${encodeURIComponent(r === "full" ? "投稿数の上限に達しました。" : r === "not_found" ? "スレッドが見つかりません。" : "送信できませんでした。")}`);
}

export async function setStatusAction(id: string, status: string) {
  await requireAdmin();
  if (!(THREAD_STATUS as readonly string[]).includes(status)) go(id, "err=" + encodeURIComponent("状態が正しくありません。"));
  let r;
  try { r = await setThreadStatus(id, status as ThreadStatus); } catch { r = "error" as const; }
  go(id, r === "ok" ? "done=1" : `err=${encodeURIComponent("変更できませんでした。")}`);
}
