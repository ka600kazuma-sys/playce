import "server-only";
import { db } from "@/lib/firebase/admin";
import { fingerprint, hashPassword, verifyPassword } from "@/lib/domain/password";
import { hashSecret, isTokenShape, newToken } from "@/lib/domain/registration";
import { TRANSFER_MAX_USES, TRANSFER_TTL_MS, memberPasswordProblem, newTransferCode, nicknameKey, nicknameProblem, normalizeNickname, transferCodeHash, transferCodeShape, normalizeTransferCode } from "@/lib/domain/member";

// 参加者アカウント。members/{id}(ニックネーム・パスワードのハッシュ)、nicknames/{ニックネームのキー}(重複防止)、memberSessions/{トークンのハッシュ}。
// パスワードそのもの・セッションのトークンは保存しない。管理用の関数は、呼び出し側で requireAdmin() を済ませること。
export const MEMBER_SESSION_MS = 400 * 24 * 3600 * 1000; // 自動ログイン用。ブラウザのCookie上限(約400日)に合わせる
const members = () => db().collection("members");
const nicknames = () => db().collection("nicknames");
const sessions = () => db().collection("memberSessions");
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export type MemberView = { id: string; nickname: string };
export type AdminMemberView = MemberView & { createdAt: number; createdBy: string; lastLoginAt: number | null };
type Raw = { nickname: string; nicknameKey: string; passwordHash?: string; createdAt: number; updatedAt: number; createdBy?: string; lastLoginAt?: number | null };

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

// 初回登録: ニックネームだけ(パスワードなし)。ニックネームの重複は nicknames のトランザクションで禁止する。
export async function createMemberNickOnly(nickname: string): Promise<CreateResult> {
  const np = nicknameProblem(nickname); if (np) return { ok: false, code: "invalid", message: np };
  const nick = normalizeNickname(nickname), key = nicknameKey(nick);
  const ref = members().doc(), nref = nicknames().doc(key), now = Date.now();
  return db().runTransaction(async (tx): Promise<CreateResult> => {
    if ((await tx.get(nref)).exists) return { ok: false, code: "taken", message: "このニックネームは、すでに使われています" };
    tx.create(nref, { memberId: ref.id });
    tx.create(ref, { nickname: nick, nicknameKey: key, createdAt: now, updatedAt: now, createdBy: "self", lastLoginAt: null } satisfies Raw);
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
  if (!ok || !d || !m || !d.passwordHash) return null; // パスワードを持たない(ニックネームのみの)アカウントは、この方法ではログインできない
  await m.ref.update({ lastLoginAt: Date.now() }).catch(() => {});
  return { id: m.id, passwordHash: d.passwordHash };
}

export async function createMemberSession(memberId: string, passwordHash?: string | null): Promise<{ token: string }> {
  const { token, hash } = newToken();
  const now = Date.now();
  await sessions().doc(hash).create({ memberId, createdAt: now, expiresAt: now + MEMBER_SESSION_MS, expireAt: new Date(now + MEMBER_SESSION_MS + 24 * 3600e3), ...(passwordHash ? { pwv: fingerprint(passwordHash) } : {}) });
  return { token };
}

// Cookie のトークンから、ログイン中のメンバーを取得する。期限切れ・パスワード変更後・削除されたメンバーは null。
export async function getMemberBySession(token: string): Promise<MemberView | null> {
  if (!isTokenShape(token)) return null;
  const sref = sessions().doc(hashSecret(token));
  const s = await sref.get();
  if (!s.exists) return null;
  const sd = s.data() as { memberId: string; expiresAt: number; pwv?: string };
  const m = await members().doc(sd.memberId).get();
  const md = m.exists ? (m.data() as Raw) : null;
  if (!md || sd.expiresAt <= Date.now() || (sd.pwv && md.passwordHash && sd.pwv !== fingerprint(md.passwordHash))) { await sref.delete().catch(() => {}); return null; }
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
  const ph = s.exists ? (s.data() as Raw).passwordHash : undefined;
  if (!ph || !(await verifyPassword(current, ph))) return { ok: false, message: "現在のパスワードが違います" };
  return setMemberPassword(id, next);
}

export async function getMemberPasswordHash(id: string): Promise<string | null> {
  if (!validId(id)) return null;
  const s = await members().doc(id).get();
  return s.exists ? ((s.data() as Raw).passwordHash ?? null) : null;
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

// ---- アカウントの引き継ぎ(機種変更) ----
// transferCodes/{コードのハッシュ}: { memberId, expiresAt, maxUses, uses }。コードそのものは保存しない。
// 発行は1メンバーにつき有効な1件だけ(再発行すると、前のコードは無効)。検証と使用回数の更新はトランザクションで行う。
const codes = () => db().collection("transferCodes");

export async function issueTransferCode(memberId: string): Promise<{ code: string; expiresAt: number } | null> {
  if (!validId(memberId)) return null;
  const m = await members().doc(memberId).get();
  if (!m.exists) return null;
  const { code, hash } = newTransferCode();
  const now = Date.now(), expiresAt = now + TRANSFER_TTL_MS;
  const old = await codes().where("memberId", "==", memberId).get();
  const batch = db().batch();
  for (const d of old.docs) batch.delete(d.ref);
  batch.create(codes().doc(hash), { memberId, createdAt: now, expiresAt, maxUses: TRANSFER_MAX_USES, uses: 0, expireAt: new Date(expiresAt + 24 * 3600e3) });
  await batch.commit();
  return { code, expiresAt };
}

export type RedeemResult = { ok: true; memberId: string; token: string } | { ok: false };

// 新しい端末でコードを入力 → 元のアカウントのセッションを発行。使用回数を消費し、元の端末を含む既存のログインはすべて無効にする。
// 失敗の理由(存在しない・期限切れ・使用済み)は区別して返さない。
export async function redeemTransferCode(raw: string): Promise<RedeemResult> {
  const norm = normalizeTransferCode(raw);
  if (!transferCodeShape(norm)) return { ok: false };
  const ref = codes().doc(transferCodeHash(norm));
  const memberId = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const d = s.data() as { memberId: string; expiresAt: number; maxUses: number; uses: number };
    if (d.expiresAt <= Date.now() || d.uses >= d.maxUses) return null;
    const m = await tx.get(members().doc(d.memberId));
    if (!m.exists) return null;
    tx.update(ref, { uses: d.uses + 1, usedAt: Date.now() });
    return d.memberId;
  });
  if (!memberId) return { ok: false };
  const { token } = await createMemberSession(memberId);
  const keep = hashSecret(token);
  const olds = await sessions().where("memberId", "==", memberId).get();
  const batch = db().batch();
  for (const d of olds.docs) if (d.id !== keep) batch.delete(d.ref);
  batch.set(db().collection("memberTransfers").doc(), { memberId, at: Date.now() }); // 引き継ぎの記録(コードは含めない)
  await batch.commit();
  return { ok: true, memberId, token };
}
