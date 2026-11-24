"use client";
import { useActionState } from "react";
import { issueTabletCodeAction, type TabletCodeState } from "./actions";

export function TabletCode({ eventId }: { eventId: string }) {
  const [state, run, pending] = useActionState<TabletCodeState>(async () => issueTabletCodeAction(eventId), {});
  return (
    <section className="space-y-2 rounded border p-3 text-sm">
      <p className="font-semibold">ふりた(会場タブレット)用コード</p>
      <p className="text-xs text-gray-600">開催前にネットにつないで、ふりたの「設定」にこのコードを入れると、受付QRが取得されます(6時間有効・20回まで)。このイベント専用で、管理者の権限は渡りません。</p>
      <form action={run}><button disabled={pending} className="rounded border px-3 py-2">コードを発行する</button></form>
      {state.code && <p className="rounded bg-gray-100 p-3 text-center font-mono text-2xl tracking-widest" aria-live="polite">{state.code}</p>}
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
    </section>
  );
}
