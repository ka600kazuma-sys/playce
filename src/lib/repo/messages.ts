import "server-only";
import { db } from "@/lib/firebase/admin";
import { hashSecret, isTokenShape, newToken } from "@/lib/domain/registration";
import { MAX_POSTS, nextStatusAfterPost, type NewThread, type Post, type ThreadStatus, type ThreadView } from "@/lib/domain/messages";

// 参加者向けはトークン(ハッシュ化してドキュメントIDに使う)でのみ参照する。管理者向けは呼び出し側で requireAdmin() を済ませること。
const col = () => db().collection("messages");
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);
type Raw = Omit<ThreadView, "id" | "postCount"> & { postCount?: number };
const toView = (id: string, d: Raw): ThreadView => ({ ...d, id, postCount: d.postCount ?? 0 });

export async function createThread(input: NewThread, eventTitle: string | null): Promise<{ token: string }> {
  const { token, hash } = newToken();
  const now = Date.now();
  const ref = col().doc(hash);
  const batch = db().batch();
  batch.create(ref, {
    nickname: input.nickname, eventId: input.eventId ?? null, eventTitle, status: "open", createdAt: now, updatedAt: now,
    unreadByAdmin: true, unreadByParticipant: false, lastFrom: "participant", postCount: 1,
  });
  batch.create(ref.collection("posts").doc(), { at: now, from: "participant", body: input.body });
  await batch.commit();
  return { token };
}

async function readPosts(ref: FirebaseFirestore.DocumentReference): Promise<Post[]> {
  const snap = await ref.collection("posts").orderBy("at").limit(MAX_POSTS).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

// 参加者がトークンでスレッドを開く(返信の既読化つき)。
export async function getThreadByToken(token: string): Promise<{ thread: ThreadView; posts: Post[] } | null> {
  if (!isTokenShape(token)) return null;
  const ref = col().doc(hashSecret(token));
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data() as Raw;
  if (d.unreadByParticipant) await ref.update({ unreadByParticipant: false });
  return { thread: toView(s.id, { ...d, unreadByParticipant: false }), posts: await readPosts(ref) };
}

export type PostResult = "ok" | "not_found" | "full";
async function addPost(ref: FirebaseFirestore.DocumentReference, from: "participant" | "organizer", body: string): Promise<PostResult> {
  return db().runTransaction(async (tx): Promise<PostResult> => {
    const s = await tx.get(ref);
    if (!s.exists) return "not_found";
    const d = s.data() as Raw;
    if ((d.postCount ?? 0) >= MAX_POSTS) return "full";
    const now = Date.now();
    tx.create(ref.collection("posts").doc(), { at: now, from, body });
    tx.update(ref, {
      updatedAt: now, lastFrom: from, postCount: (d.postCount ?? 0) + 1, status: nextStatusAfterPost(from, d.status),
      ...(from === "participant" ? { unreadByAdmin: true } : { unreadByParticipant: true }),
    });
    return "ok";
  });
}
export async function addParticipantPost(token: string, body: string): Promise<PostResult> {
  return isTokenShape(token) ? addPost(col().doc(hashSecret(token)), "participant", body) : "not_found";
}

// ---- 管理者専用 ----
export async function listThreads(): Promise<ThreadView[]> {
  const snap = await col().orderBy("updatedAt", "desc").limit(200).get();
  return snap.docs.map((d) => toView(d.id, d.data() as Raw));
}
export async function unreadCount(): Promise<number> {
  const snap = await col().where("unreadByAdmin", "==", true).count().get();
  return snap.data().count;
}
// 管理者がスレッドを開く(既読化)。
export async function openThreadAsAdmin(id: string): Promise<{ thread: ThreadView; posts: Post[] } | null> {
  if (!validId(id)) return null;
  const ref = col().doc(id);
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data() as Raw;
  if (d.unreadByAdmin) await ref.update({ unreadByAdmin: false });
  return { thread: toView(s.id, { ...d, unreadByAdmin: false }), posts: await readPosts(ref) };
}
export async function addOrganizerPost(id: string, body: string): Promise<PostResult> {
  return validId(id) ? addPost(col().doc(id), "organizer", body) : "not_found";
}
export async function setThreadStatus(id: string, status: ThreadStatus): Promise<"ok" | "not_found"> {
  if (!validId(id)) return "not_found";
  const ref = col().doc(id);
  const s = await ref.get();
  if (!s.exists) return "not_found";
  await ref.update({ status, updatedAt: Date.now() });
  return "ok";
}

// 参加者の一覧表示用(既読化せず、投稿本文も読まない)。
export async function getThreadSummary(token: string): Promise<ThreadView | null> {
  if (!isTokenShape(token)) return null;
  const s = await col().doc(hashSecret(token)).get();
  return s.exists ? toView(s.id, s.data() as Raw) : null;
}
