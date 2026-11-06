import { EVENT_STATUS, SPORTS, SPORT_LABEL, STATUS_LABEL, type EventInput } from "@/lib/domain/events";
import { toLocalInput } from "@/lib/format";

const f = "mt-1 block w-full rounded border p-3 text-base";

export function EventForm({ action, event, withRepeat }: { action: (fd: FormData) => Promise<void>; event?: EventInput; withRepeat?: boolean }) {
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-semibold">タイトル<input name="title" required maxLength={100} defaultValue={event?.title} className={f} /></label>
      <label className="block text-sm font-semibold">競技
        <select name="sport" defaultValue={event?.sport ?? "badminton"} className={f}>{SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]}</option>)}</select>
      </label>
      <label className="block text-sm font-semibold">場所<input name="venue" required maxLength={100} defaultValue={event?.venue} className={f} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-semibold">開始（日本時間）<input type="datetime-local" name="startAt" required defaultValue={event && toLocalInput(event.startAt)} className={f} /></label>
        <label className="block text-sm font-semibold">終了<input type="datetime-local" name="endAt" required defaultValue={event && toLocalInput(event.endAt)} className={f} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-semibold">参加費（円/人）<input type="number" name="feeYen" min={0} max={1000000} required defaultValue={event?.feeYen ?? 0} className={f} /></label>
        <label className="block text-sm font-semibold">定員（空欄＝なし）<input type="number" name="capacity" min={1} max={10000} defaultValue={event?.capacity ?? ""} className={f} /></label>
      </div>
      <label className="block text-sm font-semibold">持ち物<textarea name="belongings" maxLength={500} defaultValue={event?.belongings} className={f} rows={2} /></label>
      <label className="block text-sm font-semibold">注意事項<textarea name="notes" maxLength={1000} defaultValue={event?.notes} className={f} rows={3} /></label>
      <label className="block text-sm font-semibold">状態
        <select name="status" defaultValue={event?.status ?? "draft"} className={f}>{EVENT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      </label>
      {withRepeat && (
        <label className="block text-sm font-semibold">毎週くり返す回数（0＝1回のみ・最大26）
          <input type="number" name="repeatWeeks" min={0} max={26} defaultValue={0} className={f} />
        </label>
      )}
      <p className="text-xs text-gray-500">料金を変更しても、すでに申込済みの人の料金は申込時のまま維持されます。</p>
      <button className="w-full rounded bg-black p-3 font-semibold text-white">保存</button>
    </form>
  );
}
