import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { listMembers } from "@/lib/repo/members";
import { NICK_MAX, PW_MIN } from "@/lib/domain/member";
import { dateText, timeText } from "@/lib/format";
import { addMemberAction, renameMemberAction, resetMemberPasswordAction } from "./actions";

export const dynamic = "force-dynamic";
const NOTE: Record<string, string> = { added: "メンバーを追加しました。ニックネームと、決めたパスワードを、本人に伝えてください。", renamed: "ニックネームを変更しました。", reset: "パスワードを再設定しました。新しいパスワードを、本人に伝えてください(その人の、すべての端末のログインは、無効になりました)。", deleted: "メンバーを削除しました。" };

export default async function Members({ searchParams }: { searchParams: Promise<{ err?: string; done?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  let members: Awaited<ReturnType<typeof listMembers>> = [];
  let failed = false;
  try { members = await listMembers(); } catch { failed = true; }
  const stamp = (n: number | null) => (n ? `${dateText(new Date(n).toISOString())} ${timeText(new Date(n).toISOString())}` : "なし");
  const input = "mt-1 block w-full rounded border p-2 text-base";
  return (
    <main className="space-y-3">
      <h1 className="text-xl font-bold">メンバー({members.length}人)</h1>
      {sp.done && NOTE[sp.done] && <p className="rounded border p-3 text-sm">{NOTE[sp.done]}</p>}
      {(sp.err || failed) && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err ?? "読み込めませんでした。"}</p>}
      <form action={addMemberAction} className="space-y-2 rounded border p-3">
        <p className="font-semibold">メンバーを追加</p>
        <label className="block text-sm">ニックネーム(最大{NICK_MAX}文字)<input name="nickname" required maxLength={NICK_MAX} className={input} autoComplete="off" /></label>
        <label className="block text-sm">パスワード({PW_MIN}文字以上。本人に伝えて、変更してもらってください)<input name="password" required minLength={PW_MIN} maxLength={100} className={input} autoComplete="off" /></label>
        <button className="w-full rounded bg-blue-700 p-3 font-semibold text-white">追加する</button>
      </form>
      <ul className="space-y-2">
        {members.length === 0 && !failed && <li className="text-sm text-gray-500">メンバーはまだいません。</li>}
        {members.map((m) => (
          <li key={m.id} className="space-y-2 rounded border p-3">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-semibold">{m.nickname}</div><div className="text-xs text-gray-500">登録: {stamp(m.createdAt)}({m.createdBy === "admin" ? "主催者が追加" : "本人が登録"}) / 最終ログイン: {stamp(m.lastLoginAt)}</div></div>
              <Link href={`/admin/members/${m.id}/delete`} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700">削除</Link>
            </div>
            <details className="text-sm"><summary className="cursor-pointer">ニックネームを変更</summary>
              <form action={renameMemberAction.bind(null, m.id)} className="mt-2 flex gap-2"><input name="nickname" required maxLength={NICK_MAX} defaultValue={m.nickname} className="w-full rounded border p-2" aria-label="新しいニックネーム" /><button className="rounded border px-3 py-2">変更</button></form>
            </details>
            <details className="text-sm"><summary className="cursor-pointer">パスワードを再設定(本人が忘れたとき)</summary>
              <form action={resetMemberPasswordAction.bind(null, m.id)} className="mt-2 flex gap-2"><input name="password" required minLength={PW_MIN} maxLength={100} placeholder="新しいパスワード" autoComplete="off" className="w-full rounded border p-2" aria-label="新しいパスワード" /><button className="rounded border px-3 py-2">再設定</button></form>
            </details>
          </li>
        ))}
      </ul>
    </main>
  );
}
