import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { NICK_MAX, safeNext } from "@/lib/domain/member";
import { signupAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "ニックネーム登録 | PLAYCE", robots: { index: false, follow: false } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ err?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getMember()) redirect(next);
  return (
    <main className="mx-auto max-w-sm space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">はじめに、ニックネームを決めてください</h1>
      <p className="text-sm text-soft">メールアドレスやパスワードは不要です。登録は最初の1回だけで、次回からは自動でログインします。ニックネームは、あとから変更できます。</p>
      <form action={signupAction} className="space-y-3 rounded-2xl border border-line p-4">
        <input type="hidden" name="next" value={next} />
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
        <label className="block text-sm font-semibold">ニックネーム(最大{NICK_MAX}文字)
          <input name="nickname" required maxLength={NICK_MAX} autoComplete="nickname" className="mt-1 block w-full rounded border border-line p-3 text-base" />
        </label>
        <p className="text-xs text-soft">参加が確定すると、ニックネームが参加者一覧として、誰でも見られる場所に表示されます。本名は使わないでください。</p>
        <button className="w-full rounded-2xl bg-navy-deep p-3 text-lg font-semibold text-white">登録して始める</button>
      </form>
      <p className="text-center text-sm">機種変更の方は <Link href="/restore" className="font-semibold text-blue underline">引き継ぎコードを入力</Link></p>
    </main>
  );
}
