import "server-only";
import { db } from "@/lib/firebase/admin";
import { AVATAR_MAX_BYTES, isJpeg } from "@/lib/domain/mypage";

// プロフィール画像(任意)。memberAvatars/{メンバーID}。小さな JPEG だけをDBに保存し、本人だけがサーバー経由で取得できる(公開しない)。
const col = () => db().collection("memberAvatars");
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export async function setAvatar(memberId: string, bytes: Uint8Array): Promise<boolean> {
  if (!validId(memberId) || bytes.length > AVATAR_MAX_BYTES || !isJpeg(bytes)) return false;
  await col().doc(memberId).set({ data: Buffer.from(bytes), contentType: "image/jpeg", size: bytes.length, updatedAt: Date.now() });
  return true;
}
export async function getAvatar(memberId: string): Promise<{ data: Buffer; updatedAt: number } | null> {
  if (!validId(memberId)) return null;
  const s = await col().doc(memberId).get();
  if (!s.exists) return null;
  const d = s.data() as { data: Buffer | Uint8Array; updatedAt: number };
  return { data: Buffer.from(d.data), updatedAt: d.updatedAt };
}
export async function hasAvatar(memberId: string): Promise<number | null> {
  if (!validId(memberId)) return null;
  const s = await col().doc(memberId).get();
  return s.exists ? (s.data() as { updatedAt: number }).updatedAt : null;
}
export async function deleteAvatar(memberId: string): Promise<void> { if (validId(memberId)) await col().doc(memberId).delete(); }
