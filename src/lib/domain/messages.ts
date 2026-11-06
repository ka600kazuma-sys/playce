import { z } from "zod";

// 参加者と主催者のメッセージ(スレッド単位)。参加者はログイン不要で、送信時に発行される専用URL(トークン)でスレッドを開く。
export const THREAD_STATUS = ["open", "inprogress", "done"] as const;
export type ThreadStatus = (typeof THREAD_STATUS)[number];
export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = { open: "未対応", inprogress: "対応中", done: "対応完了" };

export const MAX_BODY = 1000;
export const MAX_POSTS = 200; // 1スレッドの投稿数の上限(荒らし対策)

const body = z.string().trim().min(1, "メッセージを入力してください").max(MAX_BODY, `メッセージは${MAX_BODY}文字以内で入力してください`);
export const newThreadSchema = z.object({
  nickname: z.string().trim().min(1, "ニックネームを入力してください").max(30, "ニックネームは30文字以内で入力してください"),
  body,
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});
export const postBodySchema = z.object({ body });
export type NewThread = z.infer<typeof newThreadSchema>;

export type Post = { id: string; at: number; from: "participant" | "organizer"; body: string };
export type ThreadView = {
  id: string; nickname: string; eventId: string | null; eventTitle: string | null; status: ThreadStatus;
  createdAt: number; updatedAt: number; unreadByAdmin: boolean; unreadByParticipant: boolean; lastFrom: "participant" | "organizer"; postCount: number;
};

// 投稿後のスレッド状態。参加者の投稿で「対応完了」は「未対応」に戻る。主催者の返信で「未対応」は「対応中」になる。
export function nextStatusAfterPost(from: "participant" | "organizer", cur: ThreadStatus): ThreadStatus {
  if (from === "participant") return cur === "done" ? "open" : cur;
  return cur === "open" ? "inprogress" : cur;
}
