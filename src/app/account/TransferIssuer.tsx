"use client";
import { useActionState } from "react";
import { issueTransferAction, type IssueState } from "./actions";

// 引き継ぎコードの発行。コードは画面にだけ表示し、URLや履歴には残さない。
export default function TransferIssuer() {
  const [state, run, pending] = useActionState<IssueState>(async () => issueTransferAction(), {});
  return (
    <form action={run} className="space-y-3 rounded-2xl border border-line p-4">
      <h2 className="font-semibold">機種変更・引き継ぎ</h2>
      <p className="text-xs text-soft">新しい端末で「引き継ぎコードを入力」を開き、このコードを入力します。コードは30分間・1回だけ有効で、他の人には見せないでください。引き継ぐと、この端末のログインは解除されます。</p>
      {state.error && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{state.error}</p>}
      {state.code && (
        <div className="rounded-2xl border border-line p-3 text-center">
          <p className="font-mono text-2xl font-semibold tracking-widest" data-testid="transfer-code">{state.code}</p>
          <p className="mt-1 text-xs text-soft">{new Date(state.expiresAt!).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} まで有効</p>
        </div>
      )}
      <button disabled={pending} className="w-full rounded-2xl border border-line p-3">{state.code ? "コードを再発行(前のコードは無効)" : "引き継ぎコードを発行"}</button>
    </form>
  );
}
