import { notFound } from "next/navigation";
import { getMyRegistration } from "@/lib/repo/registrations";
import { allow, requestIp } from "@/lib/repo/ratelimit";
import { changeAction } from "../../actions";
import { ManageView } from "@/components/ManageView";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

// 専用URL(トークン)で開く申込の確認・変更。ログイン導入前の申込と、専用URLを控えている人のための画面。
export default async function ManagePage({ params, searchParams }: {
  params: Promise<{ id: string; token: string }>; searchParams: Promise<{ new?: string; err?: string; done?: string }>;
}) {
  const { id, token } = await params;
  const sp = await searchParams;
  if (!(await allow("manage", await requestIp()))) return <main className="mx-auto max-w-2xl p-4">短時間にアクセスが集中しています。しばらくしてからもう一度お試しください。</main>;
  let r;
  try { r = await getMyRegistration(id, token); } catch { return <main className="mx-auto max-w-2xl p-4">読み込めませんでした。時間をおいて再度お試しください。</main>; }
  if (!r) notFound();
  return (
    <ManageView r={r} eventId={id} sp={sp}
      banner={sp.new && <p className="rounded border p-3 text-sm">申込を受け付けました。<strong>このページのURLをブックマーク</strong>してください。変更・キャンセルに必要です（他の人に共有しないでください）。</p>}
      actions={{
        keep: changeAction.bind(null, id, token, "keep", undefined), accept: changeAction.bind(null, id, token, "accept", undefined),
        decline: changeAction.bind(null, id, token, "decline", undefined), cancel: changeAction.bind(null, id, token, "cancel", undefined),
        edit: changeAction.bind(null, id, token, "edit"),
      }} />
  );
}
