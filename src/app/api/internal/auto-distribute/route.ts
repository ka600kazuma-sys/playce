import { timingSafeEqual } from "node:crypto";
import { listPublicEvents } from "@/lib/repo/events";
import { ensureNumbers } from "@/lib/repo/matches";
import { dueForNumbers } from "@/lib/domain/numbers";

// 参加番号の自動配布(Cloud Scheduler などから、数分おきに呼ぶ内部用)。ブラウザ用ではない。
// 認証: Authorization: Bearer <AUTO_JOB_SECRET>。環境変数が未設定のときは、常に拒否する(既定で無効)。
// 何度呼んでも安全(配布済みの番号は変えない。ensureNumbers がトランザクションで二重発行を防ぐ)。
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function authorized(req: Request): boolean {
  const secret = process.env.AUTO_JOB_SECRET ?? "";
  if (secret.length < 32) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? ""); // "Bearer " 形式だけを受け付ける
  if (!m) return false;
  const given = m[1];
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return json(401, { error: "unauthorized" });
  try {
    const due = dueForNumbers(await listPublicEvents(), new Date().getTime());
    for (const e of due) await ensureNumbers(e.id);
    return json(200, { ok: true, checked: due.length });
  } catch { return json(500, { error: "failed" }); }
}
