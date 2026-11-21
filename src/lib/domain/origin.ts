// 公開用のアドレス(オリジン)を決める(画面に依存しない純粋関数)。タグ・QRのURLを作るときに使う。
// 本番(Firebase App Hosting)では、アプリは Cloud Run の内部アドレス(*.run.app)で動いており、そこに直接アクセスすると「Forbidden」になる。
// リクエストの Host は内部アドレスのことがあるため、順に: ①設定(PUBLIC_ORIGIN) ②x-forwarded-host ③host を使い、内部アドレスは使わない。
const LABEL = "[a-z0-9]([a-z0-9-]*[a-z0-9])?"; // ドメインの1区切り(ハイフンで始まる・終わるものは不可)
const HOST_RE = new RegExp(`^${LABEL}(\\.${LABEL})*(:\\d{1,5})?$`);
const isInternal = (h: string) => /\.run\.app(:\d+)?$/.test(h);
const isLocal = (h: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);

// ホストとして使えるか: 書式・内部アドレスでない・URLとして解釈できる(範囲外のポート番号などを除く)。
const usable = (h: string, proto: "http" | "https") => {
  if (!h || !HOST_RE.test(h) || isInternal(h)) return false;
  try { new URL(`${proto}://${h}`); return true; } catch { return false; } // 範囲外のポート番号(65536以上)などは、ここで落ちる
};

// allowHeaders: ヘッダー(x-forwarded-host / host)から公開用のアドレスを選んでよいか。本番では false にして、設定(PUBLIC_ORIGIN)だけを使う
// (プロキシがクライアント由来の x-forwarded-host を残す環境でも、タグ・QRのリンク先が外部サイトにならないように)。開発では true。
export function publicOrigin(i: { configured?: string | null; forwardedHost?: string | null; host?: string | null; allowHeaders?: boolean }): string | null {
  const c = (i.configured ?? "").trim();
  if (c) {
    try {
      const u = new URL(c);
      const h = u.host.toLowerCase();
      const proto = u.protocol === "https:" ? "https" : u.protocol === "http:" && isLocal(h) ? "http" : null;
      if (proto && !u.username && !u.password && usable(h, proto)) return `${proto}://${h}`;
    } catch { /* 不正な設定は使わない */ }
  }
  if (i.allowHeaders === false) return null;
  for (const raw of [i.forwardedHost, i.host]) {
    const h = (raw ?? "").split(",")[0].trim().toLowerCase();
    const proto = isLocal(h) ? "http" : "https"; // 本番は常に https(転送ヘッダーの値には頼らない)
    if (usable(h, proto)) return `${proto}://${h}`;
  }
  return null;
}
