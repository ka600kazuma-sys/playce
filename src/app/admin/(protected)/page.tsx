import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";

export default async function AdminHome() {
  await requireAdmin(); // ページ単位でも検証する(レイアウトだけに頼らない)
  return (
    <main>
      <h1 className="text-xl font-bold">管理ホーム</h1>
      <ul className="mt-3 space-y-2"><li><Link href="/admin/events" className="block rounded border p-3 font-semibold">イベント管理</Link></li></ul>
      <p className="mt-3 text-sm text-gray-600">参加者管理・受付・会計は、順次ここに追加します。</p>
    </main>
  );
}
