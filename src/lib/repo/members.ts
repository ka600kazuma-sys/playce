import "server-only";
import { db } from "@/lib/firebase/admin";
import { fingerprint, hashPassword, verifyPassword } from "@/lib/domain/password";
import { hashSecret, isTokenShape, newToken } from "@/lib/domain/registration";
import { memberPasswordProblem, nicknameKey, nicknameProblem, normalizeNickname } from "@/lib/domain/member";

// 参加者アカウント。members/{id}(ニックネーム・パスワードのハッシュ)、nicknames/{ニックネームのキー}(重複防止)、memberSessions/{トークンのハッシュ}。
// パスワードそのもの・セッションのトークンは保存しない。管理用の関数は、呼び出し側で requireAdmin() を済ませること。
export const MEMBER_SESSION_MS = 30 * 24 * 3600 * 1000;
const members = () => db().collection("members");
const nicknames = () => db().collection("nicknames");
const sessions = () => db().collection("memberSessions");
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export type MemberView = { id: string; nickname: string };
export type AdminMemberView = MemberView & { createdAt: number; createdBy: string; lastLoginAt: number | null };
type Raw = { nickname: string; nicknameKey: string; passwordHash: string; createdAt: number; updatedAt: number; createdBy?: string; lastLoginAt?: number | null };

export type CreateResult = { ok: true; id: string } | { ok: false; code: "invalid" | "taken"; message: string };

export async function createMember(nickname: string, password: string, createdBy: "self" | "admin"): Promise<CreateResult> {
  const np = nicknameProblem(nickname); if (np) return { ok: false, code: "invalid", message: np };
  const pp = memberPasswordProblem(password, nickname); if (pp) return { ok: false, code: "invalid", message: pp };
  const nick = normalizeNickname(nickname), key = nicknameKey(nick), passwordHash = await hashPassword(password);
  const ref = members().doc(), nref = nicknames().doc(key), now = Date.now();
  return db().runTransaction(async (tx): Promise<CreateResult> => {
    if ((await tx.get(nref)).exists) return { ok: false, code: "taken", message: "このニックネームは、すでに使われています" };
    tx.create(nref, { memberId: ref.id });
    tx.create(ref, { nickname: nick, nicknameKey: key, passwordHash, createdAt: now, updatedAt: now, createdBy, lastLoginAt: null } satisfies Raw);
    return { ok: true, id: ref.id };
  });
}

let dummy: Promise<string> | null = null; // 存在しないニックネームでも、同じ時間をかけて照合する(存在の推測を防ぐ)
const dummyHash = () => (dummy ??= hashPassword("dummy-password-for-timing"));

export async function authenticateMember(nickname: string, password: string): Promise<{ id: string; passwordHash: string } | null> {
  if (nicknameProblem(nickname) || password.length === 0 || password.length > 400) { await verifyPassword(password, await dummyHash()); return null; }
  const n = await nicknames().doc(nicknameKey(nickname)).get();
  const m = n.exists ? await members().doc((n.data() as { memberId: string }).memberId).get() : null;
  const d = m?.exists ? (m.data() as Raw) : null;
  const ok = await verifyPassword(password, d?.passwordHash ?? (await dummyHash()));
  if (!ok || !d || !m) return null;
  await m.ref.update({ lastLoginAt: Date.now() }).catch(() => {});
  return { id: m.id, passwordHash: d.passwordHash };
}

export async function createMemberSession(memberId: string, passwordHash: string): Promise<{ token: string }> {
  const { token, hash } = newToken();
  const now = Date.now();
  await sessions().doc(hash).create({ memberId, createdAt: now, expiresAt: now + MEMBER_SESSION_MS, expireAt: new Date(now + MEMBER_SESSION_MS + 24 * 3600e3), pwv: fingerprint(passwordHash) });
  return { token };
}

// Cookie のトークンから、ログイン中のメンバーを取得する。期限切れ・パスワード変更後・削除されたメンバーは null。
export async function getMemberBySession(token: string): Promise<MemberView | null> {
  if (!isTokenShape(token)) return null;
  const sref = sessions().doc(hashSecret(token));
  const s = await sref.get();
  if (!s.exists) return null;
  const sd = s.data() as { memberId: string; expiresAt: number; pwv: string };
  const m = await members().doc(sd.memberId).get();
  const md = m.exists ? (m.data() as Raw) : null;
  if (!md || sd.expiresAt <= Date.now() || sd.pwv !== fingerprint(md.passwordHash)) { await sref.delete().catch(() => {}); return null; }
  return { id: m.id, nickname: md.nickname };
}
export async function deleteMemberSession(token: string): Promise<void> { if (isTokenShape(token)) await sessions().doc(hashSecret(token)).delete(); }

export type OpResult = { ok: true } | { ok: false; message: string };

export async function renameMember(id: string, nickname: string): Promise<OpResult> {
  if (!validId(id)) return { ok: false, message: "メンバーが見つかりません" };
  const np = nicknameProblem(nickname); if (np) return { ok: false, message: np };
  const nick = normalizeNickname(nickname), key = nicknameKey(nick), ref = members().doc(id), nref = nicknames().doc(key);
  return db().runTransaction(async (tx): Promise<OpResult> => {
    const [m, n] = await Promise.all([tx.get(ref), tx.get(nref)]);
    if (!m.exists) return { ok: false, message: "メンバーが見つかりません" };
    const cur = m.data() as Raw;
    if (cur.nicknameKey === key) { tx.update(ref, { nickname: nick, updatedAt: Date.now() }); return { ok: true }; } // 大文字小文字・全角半角だけの変更
    if (n.exists) return { ok: false, message: "このニックネームは、すでに使われています" };
    tx.create(nref, { memberId: id });
    tx.delete(nicknames().doc(cur.nicknameKey));
    tx.update(ref, { nickname: nick, nicknameKey: key, updatedAt: Date.now() });
    return { ok: true };
  });
}

// パスワードの変更。変更後は、すべての端末のログイン状態が無効になる(版が変わるため)ので、呼び出し側で新しいセッションを作る。
export async function setMemberPassword(id: string, password: string): Promise<OpResult & { passwordHash?: string }> {
  if (!validId(id)) return { ok: false, message: "メンバーが見つかりません" };
  const ref = members().doc(id), s = await ref.get();
  if (!s.exists) return { ok: false, message: "メンバーが見つかりません" };
  const pp = memberPasswordProblem(password, (s.data() as Raw).nickname); if (pp) return { ok: false, message: pp };
  const passwordHash = await hashPassword(password);
  await ref.update({ passwordHash, updatedAt: Date.now() });
  return { ok: true, passwordHash };
}
export async function changeMemberPassword(id: string, current: string, next: string): Promise<OpResult & { passwordHash?: string }> {
  if (!validId(id)) return { ok: false, message: "メンバーが見つかりません" };
  const s = await members().doc(id).get();
  if (!s.exists || !(await verifyPassword(current, (s.data() as Raw).passwordHash))) return { ok: false, message: "現在のパスワードが違います" };
  return setMemberPassword(id, next);
}

export async function getMemberPasswordHash(id: string): Promise<string | null> {
  if (!validId(id)) return null;
  const s = await members().doc(id).get();
  return s.exists ? (s.data() as Raw).passwordHash : null;
}

// ---- 表示用: 登録時ではなく「いま」のニックネームを引く(ニックネームを変えても、参加者一覧・名簿に反映する) ----
export async function currentNicknames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(validId))];
  if (uniq.length === 0) return {};
  const snaps = await db().getAll(...uniq.map((i) => members().doc(i)));
  const out: Record<string, string> = {};
  for (const s of snaps) if (s.exists) out[s.id] = (s.data() as Raw).nickname;
  return out;
}

// ---- 管理者専用 ----
export async function listMembers(): Promise<AdminMemberView[]> {
  const snap = await members().orderBy("createdAt").limit(1000).get();
  return snap.docs.map((d) => { const x = d.data() as Raw; return { id: d.id, nickname: x.nickname, createdAt: x.createdAt, createdBy: x.createdBy ?? "self", lastLoginAt: x.lastLoginAt ?? null }; });
}
export async function getMemberView(id: string): Promise<MemberView | null> {
  if (!validId(id)) return null;
  const s = await members().doc(id).get();
  return s.exists ? { id: s.id, nickname: (s.data() as Raw).nickname } : null;
}
// メンバーの削除。ニックネームを解放し、ログイン状態は(メンバーが無くなるため)すべて無効になる。実行記録を memberDeletions に残す。
// 申込の取消は、呼び出し側(registrations の adminCancel)で先に行う。
export async function deleteMemberRecord(id: string, by: string, cancelled: number): Promise<"ok" | "not_found"> {
  if (!validId(id)) return "not_found";
  const ref = members().doc(id), s = await ref.get();
  if (!s.exists) return "not_found";
  const d = s.data() as Raw;
  await db().collection("memberDeletions").doc(`${id}_${Date.now()}`).set({ memberId: id, nickname: d.nickname, by, at: Date.now(), cancelledRegistrations: cancelled });
  const batch = db().batch();
  batch.delete(nicknames().doc(d.nicknameKey)); batch.delete(ref);
  await batch.commit();
  return "ok";
}
