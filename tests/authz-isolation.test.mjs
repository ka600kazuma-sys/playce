// PLAYCE 権限・データ分離テストの雛形(node:test)。ケースIDは docs/acceptance-tests.md に対応。
// 実施済み: A1・A4・A5・E1(HTTPで直接アクセス/静的確認の範囲)は tests/authz-http.test.mjs と tests/public-data.test.mjs。
// A3・B8・D4 は実Firestoreで実施済み(tests/firestore/live.test.mjs、npm run test:firestore)。
// 以下の todo は、実ログインや実データ(Firestore 実環境またはエミュレータ)が必要で未実施。各 todo を、Firestore rules エミュレータとサーバー側 API の呼び出しに置き換えて有効化すること。
// todo のまま公開しない: scripts/check-authz-todos.sh が todo 残存を検出します。
import test from "node:test";

test.todo("A2 Googleログイン済みでも、許可リスト外のアカウントは管理機能を使えない");
test.todo("A6 ログアウト・セッション失効後は管理操作ができない");
