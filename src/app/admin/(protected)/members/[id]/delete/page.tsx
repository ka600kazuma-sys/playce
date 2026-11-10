import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getMemberView } from "@/lib/repo/members";
import { upcomingMemberRegistrations } from "@/lib/repo/registrations";
import { deleteMemberAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DeleteMember({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { err } = await searchParams;
  let m, upcoming;
  try { [m, upcoming] = await Promise.all([getMemberView(id), upcomingMemberRegistrations(id)]); } catch { return <main className="p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!m) notFound();
  const paid = upcoming.filter((u) => u.paidYen > 0).length;
  return (
    <main className="space-y-3">
      <Link href="/admin/members" className="text-sm">← メンバー一覧</Link>
      <h1 className="text-xl font-bold">メンバーを削除</h1>
      {err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err}</p>}
      <section className="rounded border p-3 text-sm"><p className="text-base font-semibold">{m.nickname}</p><p>これから開催される申込: {upcoming.length}件(入金済み {paid}件)</p></section>
      {paid > 0 ? (
        <p role="alert" className="rounded border border-red-400 p-3 text-sm">入金済みの申込があるため、削除できません。先に、受付画面で入金を取り消してください。</p>
      ) : (
        <form action={deleteMemberAction.bind(null, id)} className="space-y-3">
          <div className="rounded border border-red-400 p-3 text-sm">
            <p className="font-semibold text-red-700">この操作は元に戻せません。</p>
            <ul className="mt-1 list-disc pl-5">
              <li>このメンバーは、ログインできなくなります(ニックネームは、他の人が使えるようになります)。</li>
              <li>これから開催される申込({upcoming.length}件)は、取り消されます。空いた枠には、キャンセル待ちが繰り上がります。</li>
              <li>過去の申込・入金などの記録は、残ります。</li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1 h-5 w-5" /> 元に戻せないことを理解しました</label>
          <button className="w-full rounded bg-red-700 p-3 font-semibold text-white">このメンバーを削除する</button>
          <Link href="/admin/members" className="block rounded border p-3 text-center">やめる</Link>
        </form>
      )}
    </main>
  );
}
