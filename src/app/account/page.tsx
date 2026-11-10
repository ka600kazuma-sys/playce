import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { NICK_MAX, PW_MIN } from "@/lib/domain/member";
import { changePasswordAction, logoutAction, renameAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "アカウント | PLAYCE", robots: { index: false, follow: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ err?: string; done?: string }> }) {
  const m = await requireMember("/account");
  const sp = await searchParams;
  const input = "mt-1 block w-full rounded border border-line p-3 text-base";
  return (
    <main className="mx-auto max-w-md space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">アカウント</h1>
      <p className="text-sm">ログイン中: <strong>{m.nickname}</strong> さん</p>
      {sp.done === "nickname" && <p className="rounded border border-line p-3 text-sm">ニックネームを変更しました。</p>}
      {sp.done === "password" && <p className="rounded border border-line p-3 text-sm">パスワードを変更しました。他の端末では、ログインし直しが必要です。</p>}
      {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
      <Link href="/me" className="block rounded-2xl border border-line p-3 text-center font-semibold">自分の参加予定を見る</Link>
      <form action={renameAction} className="space-y-3 rounded-2xl border border-line p-4">
        <h2 className="font-semibold">ニックネームを変更</h2>
        <label className="block text-sm">新しいニックネーム(最大{NICK_MAX}文字)<input name="nickname" required maxLength={NICK_MAX} defaultValue={m.nickname} className={input} /></label>
        <p className="text-xs text-soft">参加者一覧など、表示は新しいニックネームに変わります。ログインにも、新しいニックネームを使います。</p>
        <button className="w-full rounded-2xl border border-line p-3">変更する</button>
      </form>
      <form action={changePasswordAction} className="space-y-3 rounded-2xl border border-line p-4">
        <h2 className="font-semibold">パスワードを変更</h2>
        <label className="block text-sm">現在のパスワード<input type="password" name="current" required autoComplete="current-password" className={input} /></label>
        <label className="block text-sm">新しいパスワード({PW_MIN}文字以上)<input type="password" name="next" required minLength={PW_MIN} autoComplete="new-password" className={input} /></label>
        <label className="block text-sm">新しいパスワード(もう一度)<input type="password" name="next2" required minLength={PW_MIN} autoComplete="new-password" className={input} /></label>
        <button className="w-full rounded-2xl border border-line p-3">変更する</button>
      </form>
      <form action={logoutAction}><button className="w-full rounded-2xl border border-red-300 p-3 text-red-700">ログアウト</button></form>
    </main>
  );
}
