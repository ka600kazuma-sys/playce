import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { AVATAR_MAX_BYTES, validAvatarJpeg } from "@/lib/domain/mypage";

// プロフィール画像(任意)。memberAvatars/{メンバーID}。小さな JPEG だけをDBに保存する。
// 本人は、いつでもサーバー経由で自分の画像を取得できる。他人は取得できない。
// 「カレンダーの参加者一覧に写真を表示する」を本人が選んだときだけ、公開用のキーが作られる(members/{ID}.photoKey)。
//   - キーは暗号乱数(128ビット)で、メンバーIDとは無関係(キーからメンバーは分からない)。
//   - 公開を止める・画像を消す・メンバーを削除する、のいずれでもキーは消え、同じURLでは二度と取得できない。もう一度公開すると、新しいキーになる。
const col = () => db().collection("memberAvatars");
const memberRef = (id: string) => db().collection("members").doc(id);
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const PHOTO_KEY_RE = /^[A-Za-z0-9_-]{22}$/;
const newKey = () => randomBytes(16).toString("base64url"); // 22文字

export type SaveResult = "ok" | "invalid" | "no_member";
// 画像の保存と、公開の設定(キーの作成・削除)を、同じトランザクションで行う。公開中の写真を、非公開で差し替えたとき、
// 古いキーで新しい画像が取得できる時間をつくらない。メンバーがいなければ(削除された直後など)、何も保存しない。
export async function saveAvatar(memberId: string, bytes: Uint8Array, wantPublic: boolean): Promise<SaveResult> {
  if (!validId(memberId) || bytes.length > AVATAR_MAX_BYTES || !validAvatarJpeg(bytes)) return "invalid";
  return db().runTransaction(async (tx): Promise<SaveResult> => {
    const m = await tx.get(memberRef(memberId));
    if (!m.exists) return "no_member";
    tx.set(col().doc(memberId), { data: Buffer.from(bytes), contentType: "image/jpeg", size: bytes.length, updatedAt: Date.now() });
    const cur = (m.data() as { photoKey?: string }).photoKey;
    if (wantPublic) { if (typeof cur !== "string") tx.update(memberRef(memberId), { photoKey: newKey() }); }
    else if (typeof cur === "string") tx.update(memberRef(memberId), { photoKey: FieldValue.delete() });
    return "ok";
  });
}
// 画像だけを設定(公開はしない)。テストや、画像だけを置くときの短縮。
export async function setAvatar(memberId: string, bytes: Uint8Array): Promise<boolean> { return (await saveAvatar(memberId, bytes, false)) === "ok"; }
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
// 削除: 画像と、公開用のキーを一緒に消す。
export async function deleteAvatar(memberId: string): Promise<void> {
  if (!validId(memberId)) return;
  const m = await memberRef(memberId).get();
  const batch = db().batch();
  batch.delete(col().doc(memberId));
  if (m.exists) batch.update(memberRef(memberId), { photoKey: FieldValue.delete() });
  await batch.commit();
}

// 公開しているか(本人の設定画面用)。
export async function getPhotoPublic(memberId: string): Promise<boolean> {
  if (!validId(memberId)) return false;
  const m = await memberRef(memberId).get();
  return m.exists && typeof (m.data() as { photoKey?: string }).photoKey === "string";
}
// 公開の切り替え(本人だけ。呼び出し側がセッションから取ったメンバーIDを渡す)。公開にするには画像が必要。
export async function setPhotoPublic(memberId: string, on: boolean): Promise<"ok" | "no_avatar" | "invalid"> {
  if (!validId(memberId)) return "invalid";
  return db().runTransaction(async (tx) => {
    const [m, a] = await Promise.all([tx.get(memberRef(memberId)), tx.get(col().doc(memberId))]);
    if (!m.exists) return "invalid";
    const cur = (m.data() as { photoKey?: string }).photoKey;
    if (!on) { if (typeof cur === "string") tx.update(memberRef(memberId), { photoKey: FieldValue.delete() }); return "ok"; }
    if (!a.exists) return "no_avatar";
    if (typeof cur !== "string") tx.update(memberRef(memberId), { photoKey: newKey() }); // すでに公開中なら、キーは変えない
    return "ok";
  });
}
// 公開用のキーから画像を取得(誰でも)。公開を選んでいない人・消した人・存在しないキーは null(区別しない)。
// キーの照合と画像の読み取りを、同じスナップショット(トランザクション)で行う。差し替えや公開の取り消しと同時でも、取り消したキーで新しい画像は返らない。
export async function getPublicPhoto(key: string): Promise<{ data: Buffer; updatedAt: number } | null> {
  if (!PHOTO_KEY_RE.test(key)) return null;
  return db().runTransaction(async (tx) => {
    const q = await tx.get(db().collection("members").where("photoKey", "==", key).limit(1));
    if (q.empty) return null;
    const a = await tx.get(col().doc(q.docs[0].id));
    if (!a.exists) return null;
    const d = a.data() as { data: Buffer | Uint8Array; updatedAt: number };
    return { data: Buffer.from(d.data), updatedAt: d.updatedAt };
  });
}
