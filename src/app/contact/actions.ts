"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { newThreadSchema, postBodySchema } from "@/lib/domain/messages";
import { formTokenState } from "@/lib/domain/abuse";
import { hashSecret, isTokenShape } from "@/lib/domain/registration";
import { addParticipantPost, createThread } from "@/lib/repo/messages";
import { getPublicEvent } from "@/lib/repo/events";
import { formSecret } from "@/lib/repo/formtoken";
import { allow, requestIp } from "@/lib/repo/ratelimit";

const BUSY = "短時間に操作が集中しています。しばらくしてからもう一度お試しください。";
const isProd = process.env.NODE_ENV === "production";
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");

// ボット対策(申込フォームと同じ): 隠し欄・署名つき描画時刻トークン・IP別の回数制限。
async function guard(fd: FormData): Promise<string | null> {
  if (text(fd, "website") !== "") return "送信を完了できませんでした。";
  const secret = formSecret();
  // 入力が早すぎても、エラーにしない(自動入力・素早い操作でも送れるように)。1.5秒に満たない分だけ、サーバーで待ってから進める。
  const raw = text(fd, "_t"), st = secret ? formTokenState(secret, raw, Date.now(), 0) : "bad";
  if (st === "expired") return "入力画面を開いてから2時間以上たちました。お手数ですが、画面を開き直して、もう一度入力してください。";
  if (st !== "ok") return "フォームを確認できませんでした。画面を開き直して、もう一度お試しください。";
  const wait = 1500 - (Date.now() - Number(raw.split(".")[0]));
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 1500)));
  if (!(await allow("contact", await requestIp()))) return BUSY;
  return null;
}

export async function sendMessageAction(fd: FormData) {
  const fail = (m: string): never => redirect(`/contact?err=${encodeURIComponent(m)}`);
  const g = await guard(fd);
  if (g) fail(g);
  const parsed = newThreadSchema.safeParse({ nickname: text(fd, "nickname"), body: text(fd, "body"), eventId: text(fd, "eventId") || undefined });
  if (!parsed.success) fail(parsed.error.issues[0].message);
  const input = parsed.data!;
  let token: string;
  try {
    let title: string | null = null;
    if (input.eventId) {
      const ev = await getPublicEvent(input.eventId);
      title = ev?.title ?? null;
      if (!ev) delete input.eventId;
    }
    token = (await createThread(input, title)).token;
  } catch {
    return fail("送信できませんでした。時間をおいて再度お試しください。");
  }
  // 同じブラウザで返信を確認できるよう、スレッドのトークンを httpOnly Cookie にも保存する
  (await cookies()).set(`msg_${hashSecret(token).slice(0, 16)}`, token, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  redirect(`/contact/t/${token}?new=1`);
}

export async function replyAction(token: string, fd: FormData) {
  const back = (q: string): never => redirect(`/contact/t/${token}?${q}`);
  if (!isTokenShape(token)) redirect("/contact");
  const g = await guard(fd);
  if (g) back(`err=${encodeURIComponent(g)}`);
  const parsed = postBodySchema.safeParse({ body: text(fd, "body") });
  if (!parsed.success) back(`err=${encodeURIComponent(parsed.error.issues[0].message)}`);
  let r;
  try { r = await addParticipantPost(token, parsed.data!.body); } catch { r = "error" as const; }
  if (r === "ok") back("sent=1");
  back(`err=${encodeURIComponent(r === "full" ? "このスレッドの投稿数の上限に達しました。新しいメッセージとして送ってください。" : r === "not_found" ? "スレッドが見つかりません。" : "送信できませんでした。時間をおいて再度お試しください。")}`);
}

// 共有の端末向け: このブラウザに保存された「過去のメッセージ」の一覧(Cookie)を消す。メッセージ自体は削除されない。
export async function forgetMessagesAction() {
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.startsWith("msg_")) jar.delete(c.name);
  redirect("/contact");
}
