"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { eventSchema, type EventInput } from "@/lib/domain/events";
import { fromLocalInput } from "@/lib/format";
import { createEvents, getEventAny, updateEvent } from "@/lib/repo/adminEvents";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function parse(fd: FormData) {
  const cap = txt(fd, "capacity");
  return eventSchema.safeParse({
    title: txt(fd, "title"), sport: txt(fd, "sport"), venue: txt(fd, "venue"),
    startAt: fromLocalInput(txt(fd, "startAt")), endAt: fromLocalInput(txt(fd, "endAt")),
    feeYen: Number(txt(fd, "feeYen") || "0"), capacity: cap === "" ? null : Number(cap),
    belongings: txt(fd, "belongings"), notes: txt(fd, "notes"), status: txt(fd, "status"),
  });
}
const back = (path: string, msg: string): never => redirect(`${path}?err=${encodeURIComponent(msg)}`);

export async function createEventAction(fd: FormData) {
  const admin = await requireAdmin();
  const p = parse(fd);
  if (!p.success) return back("/admin/events/new", p.error.issues[0].message);
  const weeks = Math.min(Math.max(Number(txt(fd, "repeatWeeks") || "0"), 0), 26);
  const seriesId = weeks > 0 ? crypto.randomUUID() : undefined;
  const list: EventInput[] = [];
  for (let i = 0; i <= weeks; i++) {
    const shift = (iso: string) => new Date(new Date(iso).getTime() + i * 7 * 24 * 3600 * 1000).toISOString();
    list.push({ ...p.data, startAt: shift(p.data.startAt), endAt: shift(p.data.endAt), ...(seriesId ? { seriesId } : {}) });
  }
  let ids: string[];
  try {
    ids = await createEvents(list, admin.email);
  } catch {
    return back("/admin/events/new", "保存できませんでした。時間をおいて再度お試しください。");
  }
  redirect(weeks > 0 ? "/admin/events" : `/admin/events/${ids[0]}?done=1`);
}

export async function updateEventAction(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const p = parse(fd);
  if (!p.success) return back(`/admin/events/${id}`, p.error.issues[0].message);
  const cur = await getEventAny(id);
  const data = { ...p.data, ...(cur?.seriesId ? { seriesId: cur.seriesId } : {}) };
  let r;
  try { r = await updateEvent(id, data, admin.email); }
  catch { return back(`/admin/events/${id}`, "保存できませんでした。時間をおいて再度お試しください。"); }
  if (r === "not_found") return back("/admin/events", "イベントが見つかりません。");
  redirect(`/admin/events/${id}?done=1`);
}

// 複製: 内容を引き継いだ下書きを作る(日時は同じ。編集画面で変更する)
export async function duplicateEventAction(id: string) {
  const admin = await requireAdmin();
  const cur = await getEventAny(id);
  if (!cur) return back("/admin/events", "イベントが見つかりません。");
  const { id: _omit, seriesId: _s, ...rest } = cur;
  void _omit; void _s;
  const [newId] = await createEvents([{ ...rest, title: `${cur.title}（コピー）`, status: "draft" }], admin.email);
  redirect(`/admin/events/${newId}?done=1`);
}
