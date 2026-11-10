import "server-only";
import { db } from "@/lib/firebase/admin";
import { currentNicknames } from "@/lib/repo/members";
import { toPublicParticipants, type PartRow, type PublicParticipants } from "@/lib/domain/participants";

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

// 公開イベント(呼び出し側で「公開中」のものだけを渡す)の、参加表明の一覧。必要なフィールド以外は読み出さず、返さない。
export async function listPublicParticipants(eventIds: string[]): Promise<Record<string, PublicParticipants>> {
  const out: Record<string, PublicParticipants> = {};
  await Promise.all(eventIds.filter(validId).map(async (id) => {
    const snap = await db().collection("events").doc(id).collection("registrations").where("status", "==", "confirmed").get();
    const raw = snap.docs.map((d) => d.data() as Partial<PartRow> & { memberId?: string });
    const names = await currentNicknames(raw.map((x) => x.memberId ?? "")); // メンバーは、登録時ではなく「いま」のニックネームで表示する
    const rows: PartRow[] = raw.map((x) => ({
      nickname: (x.memberId && names[x.memberId]) || String(x.nickname ?? ""), partySize: Number(x.partySize ?? 1), status: "confirmed", publicHidden: x.publicHidden === true, createdAt: Number(x.createdAt ?? 0),
    }));
    out[id] = toPublicParticipants(rows);
  }));
  return out;
}
