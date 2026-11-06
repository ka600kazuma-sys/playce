# 公開手順(Firebase App Hosting 案・未実施)

状態: 2026-11-06 時点で、**デプロイ・Blaze契約・公開はしていない**。`apphosting.yaml` は下書き。

## 採用案: Firebase App Hosting(Next.js のサーバー機能が必要なため)
- このアプリは Server Actions / API Routes / Cookie認証を使うため、静的ホスティングだけでは動かない。App Hosting は Next.js をそのまま動かせる(裏は Cloud Run)。公開URLは `*.web.app`(確定済み)。
- App Hosting は **Blaze(従量課金)が必須**。無料枠はあるが、超過分は課金される(最新の料金は公式で要確認。予算アラートを必ず設定)。
- 公式ドキュメント上のNext.js対応は 13.5 以上と読み取れたが、**Next.js 16.4.5 に対応しているかは未確認**(デプロイ前に公式の対応表で確認)。
- 代案: Firebase Hosting + Cloud Functions(Next.js 用のフレームワーク統合)、または Cloud Run へ直接。構成が複雑になるため第一候補ではない。

## 現在の Firebase 側の状態(確認済み)
- プロジェクト PLAYCE(`playce-e1455`)、Firestore: Standard / (default) / asia-northeast1。
- Firestore ルール: `allow read, write: if false;`(全拒否)を 2026-11-06 にこのリポジトリの `firestore.rules` からデプロイ済み(内容は同じ)。
- Authentication: Googleログイン有効(ユーザーが設定)。Webアプリ「PLAYCE Web」を 2026-11-06 に登録(アプリID `1:336328653773:web:b954f98ea983cf0b51a284`)。
- Storage ルール: 全拒否(`storage.rules`)。Storage は未使用・未有効化の可能性があり、デプロイしていない。

## ユーザーが行う操作(順番)
1. **ローカルで実際の Firebase に接続するための認証**(動作確認に必要)
   ```
   brew install --cask google-cloud-sdk
   gcloud auth application-default login
   gcloud auth application-default set-quota-project playce-e1455
   ```
   これで `npm run dev` が実際の Firestore に接続できる(開発用の個人認証。コードや鍵ファイルは作らない)。完了後、Claude が通し確認(カレンダー・申込・受付・会計・印刷)と、残りの権限テストを行う。
2. **請求先の設定(Blaze)**: Firebase コンソール → 使用量と請求 → Blaze へアップグレード → 予算アラート(例: 月1,000円)を設定。
3. **Secret Manager に秘密を登録**(承認後、Claudeが手順を案内して一緒に実行)
   - `playce-admin-emails`(許可アカウント)、`playce-form-secret`(長いランダム文字列)、`playce-firebase-web-api-key`
4. **App Hosting バックエンドの作成**(GitHub連携が前提。リポジトリ作成・push が必要)。作成・初回ロールアウトの直前に、Claude が内容を説明して再確認する。
5. **本番URLでの確認**: Firebase Authentication → 設定 → 承認済みドメインに `*.web.app` のURLが含まれることを確認し、Googleログイン・申込・受付を実機で確認。

## 公開前チェック(未了)
- [ ] 実Firestoreでの通し確認(上記1の後)
- [ ] 権限テストの todo 5件(A2・A3・A6・B8・D4。実ログイン/実データが必要)を実施し、`npm run security:check` を成功させる
- [ ] Next.js / Firebase / Node の最新の公式セキュリティ情報を確認し `docs/security-review.md` に記録(**未確認**)
- [ ] App Hosting の Next.js 16 対応と `TRUSTED_PROXY_HOPS` の実測
- [ ] App Check(ボット対策)の導入判断、`ratelimits` の TTL ポリシー設定
- [ ] Firestore の日次バックアップ設定と復元テスト
- [ ] 申込時の同意文面の確定、実機iPhoneでの確認
