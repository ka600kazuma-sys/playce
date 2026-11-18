import "server-only";
import { db } from "@/lib/firebase/admin";
import { currentMemberDisplay } from "@/lib/repo/members";
import { toPublicParticipants, type PartRow, type PublicParticipants } from "@/lib/domain/participants";

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

// 公開イベント(呼び出し側で「公開中」のものだけを渡す)の、参加表明の一覧。必要なフィールド以外は読み出さず、返さない。
export async function listPublicParticipants(eventIds: string[]): Promise<Record<string, PublicParticipants>> {
  const ids = eventIds.filter(validId);
  const loaded = await Promise.all(ids.map(async (id) => {
    const snap = await db().collection("events").doc(id).collection("registrations").where("status", "==", "confirmed").get();
    return { id, raw: snap.docs.map((d) => d.data() as Partial<PartRow> & { memberId?: string }) };
  }));
  // メンバーの情報(いまのニックネーム・公開の写真キー)は、全イベント分をまとめて1回で読む。隠した人は、名前も写真も出さないので、読まない。
  const info = await currentMemberDisplay(loaded.flatMap((e) => e.raw.filter((x) => x.publicHidden !== true).map((x) => x.memberId ?? "")));
  const out: Record<string, PublicParticipants> = {};
  for (const { id, raw } of loaded) {
    const rows: PartRow[] = raw.map((x) => {
      const shown = x.publicHidden !== true && !!x.memberId;
      return {
        nickname: (shown && info[x.memberId!]?.nickname) || String(x.nickname ?? ""), partySize: Number(x.partySize ?? 1), status: "confirmed", publicHidden: x.publicHidden === true, createdAt: Number(x.createdAt ?? 0),
        photoKey: shown ? info[x.memberId!]?.photoKey ?? null : null,
      };
    });
    out[id] = toPublicParticipants(rows);
  }
  return out;
}
