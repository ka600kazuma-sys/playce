import { getMember } from "@/lib/auth/member";
import { sameOriginOf } from "@/lib/auth/allowlist";
import { AVATAR_MAX_BYTES } from "@/lib/domain/mypage";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { deleteAvatar, getAvatar, saveAvatar, setPhotoPublic } from "@/lib/repo/avatars";

// プロフィール画像。本人だけが取得・変更・削除できる(他人の画像は取得できない。公開プロフィールは作らない)。
const H = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: H });
// 本文を、上限まで読む。上限を超えたら、読むのを中断して null。
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const guard = (req: Request) => sameOriginOf(req.headers) && req.headers.get("x-requested-with") === "playce";

export async function GET() {
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  const a = await getAvatar(m.id);
  if (!a) return json(404, { error: "none" });
  return new Response(new Uint8Array(a.data), { headers: { ...H, "Content-Type": "image/jpeg", "Content-Disposition": "inline" } });
}

// 画像の設定。?public=1 なら、カレンダーの参加者一覧にも表示する(本人が選んだときだけ。省略・0 は公開しない)。
export async function PUT(req: Request) {
  if (!guard(req)) return json(403, { error: "forbidden" });
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  if (!(await allow("avatar", await requestIp()))) return json(429, { error: "busy" });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > AVATAR_MAX_BYTES) return json(413, { error: "too_large" });
  const bytes = await readLimited(req, AVATAR_MAX_BYTES); // Content-Length がなくても、上限を超えたところで読むのをやめる
  if (!bytes) return json(413, { error: "too_large" });
  const wantPublic = new URL(req.url).searchParams.get("public") === "1";
  const r = await saveAvatar(m.id, bytes, wantPublic); // 画像の保存と公開の設定は、同じトランザクション
  if (r !== "ok") return json(400, { error: r });
  return json(200, { ok: true, public: wantPublic });
}

// 公開の切り替えだけ(画像はそのまま)。本人だけ。
export async function PATCH(req: Request) {
  if (!guard(req)) return json(403, { error: "forbidden" });
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  if (!(await allow("avatar", await requestIp()))) return json(429, { error: "busy" });
  let want: unknown;
  try { want = ((await req.json()) as { public?: unknown }).public; } catch { return json(400, { error: "invalid" }); }
  if (typeof want !== "boolean") return json(400, { error: "invalid" });
  const r = await setPhotoPublic(m.id, want);
  return r === "ok" ? json(200, { ok: true, public: want }) : json(r === "no_avatar" ? 409 : 400, { error: r });
}

export async function DELETE(req: Request) {
  if (!guard(req)) return json(403, { error: "forbidden" });
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  await deleteAvatar(m.id);
  return json(200, { ok: true });
}
