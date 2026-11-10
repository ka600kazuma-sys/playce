import { getMember } from "@/lib/auth/member";
import { sameOriginOf } from "@/lib/auth/allowlist";
import { AVATAR_MAX_BYTES } from "@/lib/domain/mypage";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { deleteAvatar, getAvatar, setAvatar } from "@/lib/repo/avatars";

// プロフィール画像。本人だけが取得・変更・削除できる(他人の画像は取得できない。公開プロフィールは作らない)。
const H = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: H });
const guard = (req: Request) => sameOriginOf(req.headers) && req.headers.get("x-requested-with") === "playce";

export async function GET() {
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  const a = await getAvatar(m.id);
  if (!a) return json(404, { error: "none" });
  return new Response(new Uint8Array(a.data), { headers: { ...H, "Content-Type": "image/jpeg", "Content-Disposition": "inline" } });
}

export async function PUT(req: Request) {
  if (!guard(req)) return json(403, { error: "forbidden" });
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  if (!(await allow("account", await requestIp()))) return json(429, { error: "busy" });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > AVATAR_MAX_BYTES) return json(413, { error: "too_large" });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!(await setAvatar(m.id, bytes))) return json(400, { error: "invalid" });
  return json(200, { ok: true });
}

export async function DELETE(req: Request) {
  if (!guard(req)) return json(403, { error: "forbidden" });
  const m = await getMember();
  if (!m) return json(401, { error: "login" });
  await deleteAvatar(m.id);
  return json(200, { ok: true });
}
