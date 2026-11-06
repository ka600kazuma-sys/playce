import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ] },
      // メッセージのスレッドURL(参加者専用)も同様に、Referer 経由で漏らさず、キャッシュしない
      { source: "/contact/t/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ] },
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
