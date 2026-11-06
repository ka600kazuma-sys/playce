import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createEventAction } from "../actions";
import { EventForm } from "../EventForm";

export default async function NewEvent({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireAdmin();
  const { err } = await searchParams;
  return (
    <main className="space-y-3">
      <Link href="/admin/events" className="text-sm">← イベント一覧</Link>
      <h1 className="text-xl font-bold">イベントを作成</h1>
      {err && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{err}</p>}
      <EventForm action={createEventAction} withRepeat />
    </main>
  );
}
