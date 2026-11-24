# リリース準備: 受付QR・周回スタンプ・クーポン・ふりた連携(2026-11-24 作成・未公開)

状態: ブランチ `feature/furita-qr-stamps`(コミット済み・push前)。`main` へのマージ・push・ロールアウトは、承認後に行う。

## 変更の範囲
- 追加の保存先(すべてサーバー経由・rules全拒否のまま): `coupons`、`stampLedger`、`tabletCodes`、`events/{id}/walkinRequests`、`stampCards` に `lap` `visits` `model` を追加、`stampConfig/default` に `lapRewards` `couponPolicy` を追加、イベントに `stampMultiplier`(未設定は1倍)。
- **既存データの変更・削除は行わない。** 既存カードは `points` を累計として読み(lap未設定=1周目)、最初の付与時に `lap` `points` `model:2` を書き込む。旧カードの5pt(満タン)は、次の付与で「2周目1pt」になる(旧仕様の「5の次は1」と同じ動き)。
- 新しい入口: `/r/[eventId]/[token]`、`/r/resume`、`/r/result`、`/api/furita/sync`、`/stamp/points`、`/admin/stamp/members`、`/admin/stamp/settings`、`/furita/index.html`(ふりた本体。同一オリジン配信)。
- 直接値引き(スタンプ割引の適用)は廃止し、クーポンのみ(ユーザー決定)。受付画面の旧ボタンは「クーポン方式に変わりました」と出る。
- 新しい環境変数・秘密: なし(既存の `FORM_SECRET`・`PUBLIC_ORIGIN` を使う。両方とも `apphosting.yaml` に設定済み)。新しい依存: なし(`qrcode-generator` は既存。ふりた用にコピー)。Firestoreの複合インデックス: 不要(等価条件のみ)。

## 公開前チェック
- [x] 単体155件、実Firestore 44件(受付QR・管理者操作・ふりた取得・スタンプ・会員)、`next build`、`npm run security:check`(npm audit・osv-scanner・gitleaks: 問題なし)
- [x] Codexレビュー3回(コード2回・画面1回)の指摘を修正(対応しなかったものは `docs/security-review.md` に残存リスクとして記載)
- [ ] **Firestoreのバックアップ**(ユーザー操作): この端末の gcloud は未ログイン。`gcloud auth login` のあと、`gcloud firestore export gs://<バケット>/pre-furita-qr --project=playce-e1455`(バケットが無ければ作成が必要=課金・設定の確認)。または、既存データを変更しない変更のため、ロールバック手順(下記)で足りるかの判断。
- [ ] **実機確認**(ユーザー操作): 手順は `~/downloadtemp/furita/docs/ipad-test.md` 7章(Q1〜Q7)。iPad(iOS 9.3.5)でホーム画面から開いて取得→QR→機内モード→タイマー継続、スマホの標準カメラでの読み取り、受付→支払い確認→スタンプ→クーポン、の通し。
- [ ] 本番反映後のスモーク確認(下記)

## 反映手順(承認後)
1. `git checkout main && git merge --no-ff feature/furita-qr-stamps`、`git push origin main`(認証済みの `gh` を使用)
2. `firebase apphosting:rollouts:create playce --git-branch main --project playce-e1455`(ロールアウトの成功を確認)
3. スモーク確認: トップ200、`/stamp` `/stamp/points` は未ログインでログインへ、`/admin/stamp/members` は管理者ログインなしでログインへ、`/furita/index.html` 200 と `furita.appcache` の Content-Type が `text/cache-manifest`、`/api/furita/sync` の GET が405・不正な POST が403/400、`/r/xxx/yyy` が未ログインでログインへ(または結果画面へ)。
4. 管理画面でテスト用イベント(非公開でよい)を作り、ふりた用コードの発行→ふりたで取得→QR表示→自分のスマホで受付→支払い確認→スタンプとクーポンの確認、まで通す(終了後に削除)。

## ロールバック
- 直前のロールアウトに戻す(App Hosting のコンソール、または前のコミットで再ロールアウト)。追加したフィールド・コレクションは旧コードから無視される(旧コードは `points` を 0〜5 として読むため、2周目以降の会員は旧画面でポイントが小さく見える可能性がある)。データの削除は不要。

## 公開後に残る確認・判断事項
- 未確定事項(クーポンの有効期限・当日使用・併用・無料券使用時のポイント・種目間共通化・既存会員の移行)は暫定値で動く。管理画面 `/admin/stamp/settings` で、当日使用と有効日数を変更できる。
- 受付・支払いの取り消しで、付与済みポイントは自動では戻らない(会員のスタンプ操作で手動取り消し)。
- QRの有効期間は、開催の前後2時間・最大12時間分。
- iOS 9.3.5実機・スマホ実機は未確認(上記)。
