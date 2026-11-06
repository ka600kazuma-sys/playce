"use client";
import { useState } from "react";

// 同行者のニックネーム入力。代表者を含めて最大10人。
export function MemberFields({ initial }: { initial: string[] }) {
  const [rows, setRows] = useState<string[]>(initial);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">同行者のニックネーム（任意・最大9人）</legend>
      {rows.map((v, i) => (
        <div key={i} className="flex gap-2">
          <input name="members" defaultValue={v} maxLength={30} className="block w-full rounded border p-3 text-base" autoComplete="off" />
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded border px-3" aria-label="この同行者を削除">削除</button>
        </div>
      ))}
      {rows.length < 9 && <button type="button" onClick={() => setRows([...rows, ""])} className="rounded border px-3 py-2 text-sm">＋ 同行者を追加</button>}
    </fieldset>
  );
}
