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
      <p className="text-sm text-soft">ふだんは、ログイン操作は不要です(自動でログインします)。ここは、はじめての方・機種変更の方・以前パスワードを設定した方の入口です。</p>
      <div className="grid gap-2">
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="rounded-2xl bg-navy-deep p-3 text-center font-semibold text-white">はじめての方(ニックネームだけで登録)</Link>
        <Link href="/restore" className="rounded-2xl border border-line p-3 text-center font-semibold">機種変更の方(引き継ぎコード)</Link>
      </div>
      <h2 className="pt-2 text-sm font-semibold">以前パスワードを設定した方</h2>
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
      <p className="text-center text-xs text-soft">パスワードを忘れたときは、主催者に連絡してください(再設定します)。</p>
    </main>
  );
}
