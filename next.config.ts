import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ] },
      // メッセージのスレッドURL(参加者専用)も同様に、Referer 経由で漏らさず、キャッシュ・検索登録をしない
      { source: "/contact/t/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      // ブラウザごとに内容が変わる画面(Cookieに基づく一覧)は、共有キャッシュ(CDN)に保存させない
      { source: "/contact", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/me", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // 個別管理URLを Referer 経由で外部に漏らさない
      { source: "/events/:id/r/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ] },
    ];
  },
  // Cache Components / use cache は使わない(2026-11-03 公開の Next.js Moderate 脆弱性の対象。docs/security-review.md)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
