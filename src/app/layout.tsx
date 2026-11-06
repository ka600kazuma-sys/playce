import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getAdmin } from "@/lib/auth/session";
import { SiteShell } from "@/components/SiteShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PLAYCE イベントカレンダー",
  description: "PLAYCEのスポーツイベントカレンダー。ニックネームだけで参加申込できます。",
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const, themeColor: "#ffffff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // メニューの出し分け用。保護はサーバー側(requireAdmin)が行う。確認できなければ参加者として扱う。
  const isAdmin = await getAdmin().then((a) => !!a, () => false);
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><SiteShell isAdmin={isAdmin}>{children}</SiteShell></body>
    </html>
  );
}
