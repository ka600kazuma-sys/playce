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
      // スタンプのタグURL(署名つき)は、Referer に漏らさず、キャッシュ・検索登録をしない。スタンプ画面は本人専用のため共有キャッシュに載せない
      { source: "/stamp/t/:sport/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      { source: "/stamp/q/:eventId/:count/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      { source: "/stamp", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/stamp/settings", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // 受付QR(署名つき)。Referer に漏らさず、キャッシュ・検索登録をしない。ふりた(同一オリジンで配信)の取得APIも同様。
      { source: "/r/:eventId/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      { source: "/r/resume", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }] },
      // ふりた: Application Cache(オフライン用)の定義は、専用のContent-Typeで配信し、常に最新を確認させる(iOS 9.3.5向け)
      { source: "/furita/furita.appcache", headers: [{ key: "Content-Type", value: "text/cache-manifest; charset=utf-8" }, { key: "Cache-Control", value: "no-cache" }] },
      { source: "/furita/:path*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // 個別管理URLを Referer 経由で外部に漏らさない
      { source: "/events/:id/r/:token", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ] },
    ];
  },
  // /furita は、相対パス(Application Cache の定義など)が正しく解決されるよう、index.html のURLへ移す
  async redirects() { return [{ source: "/furita", destination: "/furita/index.html", permanent: false }, { source: "/furita/", destination: "/furita/index.html", permanent: false }]; },
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
