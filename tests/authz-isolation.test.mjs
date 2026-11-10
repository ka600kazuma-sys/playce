// 権限・データ分離テストの所在(todoは残さない: scripts/check-authz-todos.sh が todo 残存を検出します)。
//  A1・A4・A5・E1: tests/authz-http.test.mjs, tests/public-data.test.mjs(HTTPで直接アクセス/静的確認)
//  A2・A6: tests/firestore/admin-login.test.mjs(パスワードログイン・ログアウト・期限切れ・実Firestore+実HTTP)
//  A3・B8・D4: tests/firestore/live.test.mjs(実Firestore)
//  メッセージ・参加者一覧の隔離: tests/firestore/messages-isolation.test.mjs, tests/firestore/participants.test.mjs
