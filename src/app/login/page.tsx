import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { safeNext } from "@/lib/domain/member";
import { loginAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン | PLAYCE", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getMember()) redirect(next);
  return (
    <main className="mx-auto max-w-sm space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">ログイン</h1>
      <p className="text-sm text-soft">参加申込には、ログインが必要です。ニックネームとパスワードを入力してください。</p>
      <form action={loginAction} className="space-y-3 rounded-2xl border border-line p-4">
        <input type="hidden" name="next" value={next} />
        {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
        <label className="block text-sm font-semibold">ニックネーム
          <input name="nickname" required maxLength={20} autoComplete="username" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <label className="block text-sm font-semibold">パスワード
          <input type="password" name="password" required maxLength={100} autoComplete="current-password" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <button className="w-full rounded-2xl bg-navy-deep p-3 text-lg font-semibold text-white">ログイン</button>
      </form>
      <p className="text-center text-sm">はじめての方は <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-blue underline">新規登録</Link></p>
      <p className="text-center text-xs text-soft">パスワードを忘れたときは、主催者に連絡してください(再設定します)。</p>
    </main>
  );
}
