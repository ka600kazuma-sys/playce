import Link from "next/link";
import { notFound } from "next/navigation";
import { SOON_TITLES } from "@/lib/menu";

export const metadata = { title: "準備中 | PLAYCE" };

// 未実装機能の「準備中」画面。動作済みのように見せない。
export default async function SoonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = Object.hasOwn(SOON_TITLES, slug) ? SOON_TITLES[slug] : null;
  if (!item) notFound();
  return (
    <main className="mx-auto grid max-w-lg gap-3 py-10 text-center">
      <h1 className="font-serif text-2xl">{item.title}</h1>
      <p className="font-semibold">準備中です。</p>
      <p className="leading-7 text-soft">{item.note}</p>
      <Link href="/" className="mx-auto mt-2 rounded-full border border-blue px-5 py-2 text-blue">カレンダーに戻る</Link>
    </main>
  );
}
