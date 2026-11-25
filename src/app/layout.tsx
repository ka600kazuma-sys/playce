import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getAdmin } from "@/lib/auth/session";
import { getMemberForRender } from "@/lib/auth/member";
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
  description: "PLAYCEのスポーツイベントカレンダー。ニックネームで参加申込できます。",
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const, themeColor: "#ffffff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // メニューの出し分け用。保護はサーバー側(requireAdmin)が行う。確認できなければ参加者として扱う。
  // 2つの確認は互いに独立なので、同時に行う(待ち時間を足し算にしない)。
  const [isAdmin, memberNickname] = await Promise.all([
    getAdmin().then((a) => !!a, () => false),
    getMemberForRender().then((m) => m?.nickname ?? null, () => null),
  ]);
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><SiteShell isAdmin={isAdmin} memberNickname={memberNickname}>{children}</SiteShell></body>
    </html>
  );
}
