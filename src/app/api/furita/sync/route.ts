import { headers } from "next/headers";
import { publicOrigin } from "@/lib/domain/origin";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { redeemTabletCode } from "@/lib/repo/furitasync";

export const dynamic = "force-dynamic";
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

// ふりたの事前取得。ふりた用コード(主催者が発行・期限つき)を受け取り、開催情報と受付QRのトークン一覧を返す。Cookie・管理者の認証は使わない。
// 同一オリジン(ふりたを同じサイトから配信)からだけ受け付ける。回数制限あり。
export async function POST(req: Request) {
  const h = await headers();
  const origin = publicOrigin({ configured: process.env.PUBLIC_ORIGIN, forwardedHost: h.get("x-forwarded-host"), host: h.get("host"), allowHeaders: process.env.NODE_ENV !== "production" });
  const o = req.headers.get("origin");
  if (!origin || (o !== null && o !== origin) || req.headers.get("x-requested-with") !== "furita") return json(403, { error: "forbidden" });
  if (!(await allow("furita", await requestIp()))) return json(429, { error: "busy" });
  let b: unknown;
  try { b = await req.json(); } catch { return json(400, { error: "invalid" }); }
  const code = typeof b === "object" && b !== null ? (b as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return json(400, { error: "invalid" });
  try {
    const r = await redeemTabletCode(code);
    return r ? json(200, { ...r, origin }) : json(400, { error: "invalid" });
  } catch { return json(500, { error: "retry" }); }
}
