import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "主催者ログイン", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <main className="mx-auto max-w-sm space-y-4 p-4">
      <h1 className="text-xl font-bold">PLAYCE 主催者ログイン</h1>
      <p className="text-sm">主催者のパスワードを入力してください。</p>
      <LoginForm />
    </main>
  );
}
