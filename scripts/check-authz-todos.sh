#!/usr/bin/env bash
# 認証/分離テストが todo のまま残っていたら公開前チェックで失敗させる
if grep -rEq "test\.todo\(" tests 2>/dev/null; then echo "authz/分離テストが未実装(test.todo残り)"; exit 1; fi
