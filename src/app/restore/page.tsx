import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/lib/auth/member";
import { redeemTransferAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "アカウントの引き継ぎ | PLAYCE", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function RestorePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  if (await getMember()) redirect("/account");
  return (
    <main className="mx-auto max-w-sm space-y-4 py-6">
      <h1 className="font-serif text-xl font-medium text-navy">アカウントの引き継ぎ</h1>
      <p className="text-sm text-soft">機種変更などのときは、前の端末で「アカウント」画面から発行した引き継ぎコードを入力してください。コードは30分間、1回だけ使えます。引き継ぐと、前の端末のログインは解除されます。</p>
      <form action={redeemTransferAction} className="space-y-3 rounded-2xl border border-line p-4">
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}><label>ウェブサイト<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        {sp.err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{sp.err}</p>}
        <label className="block text-sm font-semibold">引き継ぎコード
          <input name="code" required maxLength={30} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" className="mt-1 block w-full rounded border border-line p-3 font-mono text-base tracking-wider" />
        </label>
        <button className="w-full rounded-2xl bg-navy-deep p-3 text-lg font-semibold text-white">引き継ぐ</button>
      </form>
      <p className="text-center text-sm"><Link href="/signup" className="text-blue underline">はじめての方はこちら</Link></p>
    </main>
  );
}
