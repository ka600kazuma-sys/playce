# セキュリティ確認記録

公式情報の確認ごとに追記する(確認できなかった項目は「未確認」と書く)。

| 確認日 | 対象技術・バージョン | 参照元(公式URL) | 自アプリへの影響 | 対応 / 状態 |
|---|---|---|---|---|
| 2026-11-04 | Node.js 24.x(端末は v24.22.1) | https://nodejs.org/en/blog/vulnerability/october-2026-security-releases | 2026-10-21の修正版は 22.23.4 / 24.22.1 / 26.12.1。High 4件(Brotli RCE、DNS、TLS検証)。端末の v24.22.1 は修正済み | 開発・本番とも 24.22.1 以上を使う。本番の実行環境バージョンは未確認 |
| 2026-11-04 | Next.js 16.x / 15.5.x | https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw (CVE-2026-96889, Critical 9.5, 画像最適化のRCE) | 修正版は 15.5.28 / 16.4.1。同様に 2026-09-22 の next/og RCE(GHSA-vcvr-r3jv-pc5j, Critical)も公開 | 16.4.1 以上を使う。画像最適化で SVG を扱わない設計も検討 |
| 2026-11-04 | Next.js 16.x(11/3公開のModerate 7件) | https://github.com/vercel/next.js/security/advisories (例: GHSA-7qx7-33qx-rqx2) | 影響は `use cache`、画像最適化、Edge の cookie 露出など。GHSA-7qx7 は「修正版なし」と表示(16.0.0〜16.4.2 が対象) | 7件の修正状況は**未確認**。`use cache` / Cache Components / Edge runtime は使わない。着手時に再確認 |
| 2026-11-04 | npm レジストリの最新版 | `npm view`(公式レジストリ) | next latest=16.4.5 / backport=15.5.29、firebase=13.2.0、tailwindcss=4.3.4。firebase-admin は npm キャッシュ権限エラーで**未確認** | 採用版は着手時に再取得し、lockfile で固定 |
| 2026-11-04 | Firebase Firestore(セキュリティ概要) | https://firebase.google.com/docs/firestore/security/overview | クライアントは Auth + Security Rules、サーバー(Admin SDK)は IAM で制御。App Check の利用を推奨。ページに「既定拒否」の記載はなし(rules の get started 側で要確認) | PLAYCEはサーバー経由を基本とし、rules は全拒否にする。App Check を導入候補にする |
| 2026-11-04 | Firebase App Hosting | https://firebase.google.com/docs/app-hosting | Next.js を標準サポート。**Blaze(従量課金)プランが必要**。実行は Cloud Run、秘密情報は Secret Manager。Next.js/Node の対応バージョンは記載なし | Blaze は新規有料契約のため、ユーザー承認後に有効化。開発中はエミュレータを使う |
| 2026-11-04 | Firebase JS SDK 13.2.0 | https://firebase.google.com/support/release-notes/js | 12.17.0 で FirebaseError の ReDoS を修正済み。13.0.0 で AI Logic に破壊的変更(使うのは後日)。12.17.0 で App Check は provider 必須。リリースノート後半(約108,000字)は未読 | 13.2.0 を採用候補にする。lockfile で固定 |
| 2026-11-04 | プロジェクト依存関係(next 16.4.5, react 19.3.0, tailwindcss 4) | osv-scanner / npm audit(OSV・GitHub Advisory) | 本番依存は脆弱性0件。開発依存の minimatch(Moderate, GHSA-g3hv-75wg-m249)が eslint 経由で残っていた | package.json の `overrides` で minimatch 11.0.1 に固定。lint・ビルド成功を確認し、security-check は問題なし |
| 2026-11-04 | 管理者認証の実装(firebase 13.2.0 / firebase-admin 14.5.0) | https://firebase.google.com/docs/auth/admin/manage-cookies(未取得。実装は Admin SDK の標準 API に依存) | verifyIdToken(checkRevoked)、createSessionCookie、verifySessionCookie(checkRevoked) を使用。公式ドキュメントでの推奨事項の突き合わせは**未確認** | 本番公開前に公式ドキュメントと照合して追記 |

## 公開前チェック
- [ ] `scripts/security-check.sh` が成功(exit 0)
- [ ] 認証・分離テスト(todo残りなし)が成功
- [ ] High/Critical の未対応脆弱性なし
- [ ] 実行環境・DB・ストレージ設定の公式情報を確認し、上表に記録
## 2026-11-06 実環境設定の確認
- 確認: Firestore ルール全拒否を実環境へ反映(`firebase deploy --only firestore:rules`)。`npm audit`・osv-scanner・gitleaks は問題なし(`scripts/security-check.sh`)。
- 追加した権限テスト: 未ログイン/偽Cookieで管理画面7種はログインへ誘導、CSVは403、オフライン受付APIはヘッダ・オリジン・未ログインで拒否、セッション発行APIは不正トークンで発行なし(HTTPで直接呼出し)。公開イベントの読み取りは公開フィールドのみ(静的確認)。
- **未確認**: 実Firestoreでの動作、実ログインでのセッション・許可リスト検証(A2/A6)、申込の他人アクセス(A3)、同時操作の整合(B8)、入金の二重計上防止(D4)、Next.js 16 の App Hosting 対応、`TRUSTED_PROXY_HOPS`、Firebase/Next.js/Node の最新公式勧告の個別確認。

## 2026-11-06 実環境での権限・整合の確認結果
- 実Firestore(playce-e1455)で `npm run test:firestore` が成功: B8(同時申込・同時キャンセル)、A3(他人の申込・管理URL推測・別イベント流用)、D4(入金・経費の冪等性、残額超過、取消、会計確定中の拒否)。テスト用データは終了時に削除済み。
- 実ログイン(ka.600.kazuma@gmail.com、Googleポップアップ): ログイン成功 → 管理画面・当日受付・受付/支払・CSV・印刷名簿・会計・経費追加が動作。受付/支払の監査ログに操作者メールが記録された。
- ログアウト: `DELETE /api/auth/session` 200。Firebase Auth のユーザー記録で、トークン失効時刻(tokensValidAfterTime)が更新され、その後の再ログインが成功していることを確認(失効の仕組みが動作)。**ログアウト後に古いCookieで管理画面を開いて拒否される場面は、自動テストでは未確認**(A6は todo のまま)。
- **未確認**: 許可していない実際のGoogleアカウントでのログイン拒否(A2。ロジックは単体テストで確認済み)。Firebase Auth には管理者1名のみ。使い捨てユーザーでの自動テストは、ローカルのADC(個人認証)ではカスタムトークンに署名できず実施できなかった。
- 検査: `scripts/security-check.sh` は、`.env.local`(Git管理外)内の公開用Web APIキーと手元用の署名キーを検出して失敗する。扱いはユーザー判断待ち(検査は無効化していない)。

## 2026-11-06 検査の例外(ユーザー承認済み)
- `.gitleaksignore` で、`.env.local`(Git管理外)の2件(公開用Web APIキー、手元用 FORM_SECRET)のみを許容。検査は無効化していない。他のファイルの検出は従来どおり失敗させる。
- 理由: Gitに含まれないローカルの設定ファイルで、Web APIキーは公開前提の値、FORM_SECRET は本番と別の値を使う。
- 見直し期限: 2026-12-06。`.env.local` の行番号が変わると例外は外れ、検査が再び失敗する(意図どおり)。

## 2026-11-10 主催者ログインをパスワード方式へ変更
- 理由: ユーザーがGoogleログインでブロックされたため、決めたパスワードでのログインへ変更（ユーザー決定）。
- 対策: scrypt ハッシュ（ソルト付き・一定時間比較）、同一オリジン確認、IPごと5回/10分の制限、失敗時の待ち時間、セッションはDBにハッシュのみ保存・8時間・サーバー側で失効可能・パスワード変更で全無効、Cookie は HttpOnly/Secure/SameSite=Strict、入力は NFKC 正規化。
- 注意（残るリスク）: パスワードのみの認証（2段階認証なし）のため、Googleログイン＋2段階認証より弱い。弱いパスワードや使い回しは禁物。IPを変えながらの分散した総当たりは、各IPの回数制限だけでは完全には防げない（14文字以上の強いパスワードで実質的に防ぐ）。将来、2段階認証（TOTP）の追加を検討。
- テスト: A2・A6 を実環境（実Firestore＋実Next.js）で実施し、権限テストの todo はなくなった。

## 2026-11-10 参加者アカウント（ニックネーム＋パスワード）
- 対策: パスワードは scrypt ハッシュ（DBに平文なし）、ログインは IP別・ニックネーム別の回数制限と失敗時の待ち、存在しないニックネームでも同じ時間をかけて照合（存在の推測を防ぐ）、セッショントークンはハッシュのみ保存・有効期限30日・パスワード変更/メンバー削除で失効、`next` は同一サイトの相対パスのみ（オープンリダイレクト防止）、申込は本人のメンバーIDで認可（他人の申込は存在しない扱い）、代表者名はサーバー側でログイン中のメンバーから取得（なりすまし防止）。
- 残るリスク: パスワードのみの認証（弱いパスワード・使い回し）。ニックネームが公開の参加者一覧に出る（本名を使わない旨を登録画面・申込画面に明記）。分散した総当たりは、ニックネームごとの制限で緩和するが、同一アカウントを狙った一時的なロックアウトは起こり得る（10分で解除）。パスワード再設定は主催者が行う（メール確認なし）。
- 未確認: 実機iPhone、パスワード管理アプリとの連携の使い勝手。
