import type { MetadataRoute } from "next";

// ホーム画面に追加したときのアプリ名・アイコン。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PLAYCE",
    short_name: "PLAYCE",
    description: "PLAYCEのスポーツイベントカレンダー",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b3270",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
