import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { NICK_MAX, PW_MIN, safeNext } from "@/lib/domain/member";
import { signupAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "新規登録 | PLAYCE", robots: { index: false, follow: false } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ err?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getMember()) redirect(next);
  return (
    <main className="mx-auto max-w-sm space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">新規登録</h1>
      <p className="text-sm text-soft">ニックネームとパスワードを決めてください。ニックネームは、あとから変更できます。</p>
      <form action={signupAction} className="space-y-3 rounded-2xl border border-line p-4">
        <input type="hidden" name="next" value={next} />
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
        <label className="block text-sm font-semibold">ニックネーム(最大{NICK_MAX}文字)
          <input name="nickname" required maxLength={NICK_MAX} autoComplete="username" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <label className="block text-sm font-semibold">パスワード({PW_MIN}文字以上)
          <input type="password" name="password" required minLength={PW_MIN} maxLength={100} autoComplete="new-password" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <label className="block text-sm font-semibold">パスワード(もう一度)
          <input type="password" name="password2" required minLength={PW_MIN} maxLength={100} autoComplete="new-password" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <p className="text-xs text-soft">参加が確定すると、ニックネームが参加者一覧として、誰でも見られる場所に表示されます。本名は使わないでください。</p>
        <button className="w-full rounded-2xl bg-navy-deep p-3 text-lg font-semibold text-white">登録する</button>
      </form>
      <p className="text-center text-sm">登録済みの方は <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-blue underline">ログイン</Link></p>
    </main>
  );
}
