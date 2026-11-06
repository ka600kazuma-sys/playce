import { getAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/allowlist";
import { applyCheckInOp, recordPayment } from "@/lib/repo/reception";
import { isOpId } from "@/lib/domain/offline";

// オフライン受付の同期用(主催者のみ)。受付チェックと支払いを、操作ID(冪等性キー)つきで1件ずつ受け取る。
// 画面を隠すだけでは保護にならないため、ここでも getAdmin() と同一オリジンを毎回確認する。
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const idOk = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);

export async function POST(req: Request) {
  if (!isSameOrigin(req.headers.get("origin"), req.headers.get("host")) || req.headers.get("x-requested-with") !== "playce") return json(403, { error: "forbidden" });
  const admin = await getAdmin();
  if (!admin) return json(401, { error: "ログインが必要です" });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { error: "invalid" }); }
  if (!idOk(b.eventId) || !idOk(b.regId) || !isOpId(b.opId)) return json(400, { error: "invalid" });
  try {
    if (b.type === "checkin" && typeof b.value === "boolean" && typeof b.expect === "boolean") {
      const r = await applyCheckInOp(b.eventId, b.opId, b.regId, b.value, b.expect, b.force === true, admin.email);
      return json(r === "ok" ? 200 : r === "conflict" ? 409 : 400, { result: r });
    }
    if (b.type === "pay" && typeof b.amountYen === "number") {
      const r = await recordPayment(b.eventId, b.opId, [{ regId: b.regId, amountYen: b.amountYen }], admin.email); // opId が冪等性キー
      return json(r === "ok" ? 200 : 400, { result: r });
    }
    return json(400, { error: "invalid" });
  } catch {
    return json(500, { error: "処理できませんでした" });
  }
}
