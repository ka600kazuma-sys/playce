import { requireAdmin } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "PLAYCE 管理", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between text-sm print:hidden">
        <span className="font-semibold">PLAYCE 管理</span>
        <span className="flex items-center gap-3"><span>{admin.email}</span><LogoutButton /></span>
      </header>
      {children}
    </div>
  );
}
