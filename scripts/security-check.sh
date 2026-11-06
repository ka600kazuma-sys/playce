#!/usr/bin/env bash
# 使い方: security-check.sh [project-dir] [--quiet]
# 依存脆弱性 + 秘密情報検査を実行。High/Critical または秘密検出で exit 1。
# 検査ツール未導入の場合は「未確認」として exit 2(成功扱いにしない)。
set -u
DIR="${1:-.}"; cd "$DIR" || exit 3
fail=0; unchecked=0
say() { echo "[$(basename "$PWD")] $*"; }

# --- 依存脆弱性 ---
if [ -f package-lock.json ]; then
  if command -v npm >/dev/null; then
    out=$(npm audit --omit=dev --audit-level=high 2>&1); rc=$?
    if [ $rc -ne 0 ]; then
      if echo "$out" | grep -qiE "ENOTFOUND|network|EAI_AGAIN|ECONN"; then say "npm audit: 未確認(ネットワーク不可)"; unchecked=1
      else say "npm audit: High以上の脆弱性あり"; echo "$out" | tail -25; fail=1; fi
    else say "npm audit: OK (high以上なし)"; fi
  fi
fi
if command -v osv-scanner >/dev/null; then
  lockargs=()
  for f in package-lock.json pubspec.lock Package.resolved Podfile.lock requirements.txt poetry.lock go.sum Cargo.lock functions/package-lock.json; do
    [ -f "$f" ] && lockargs+=(-L "$f")
  done
  if [ ${#lockargs[@]} -gt 0 ]; then
    out=$(osv-scanner scan source "${lockargs[@]}" 2>&1); rc=$?
    if [ $rc -eq 0 ]; then say "osv-scanner: OK"
    elif [ $rc -eq 1 ]; then say "osv-scanner: 既知の脆弱性あり(深刻度は要確認)"; echo "$out" | tail -40; fail=1
    else say "osv-scanner: 未確認(エラー rc=$rc)"; echo "$out" | tail -5; unchecked=1; fi
  fi
else say "osv-scanner 未導入: 未確認(brew install osv-scanner)"; unchecked=1; fi

# --- 秘密情報 ---
if command -v gitleaks >/dev/null; then
  if [ -d .git ]; then gitleaks dir . --config "/Users/ooharakazuma/.claude/security-kit/gitleaks.toml" --no-banner --redact >/tmp/gl.$$ 2>&1 || gitleaks detect --no-git --config "/Users/ooharakazuma/.claude/security-kit/gitleaks.toml" --no-banner --redact >/tmp/gl.$$ 2>&1
  else gitleaks dir . --config "/Users/ooharakazuma/.claude/security-kit/gitleaks.toml" --no-banner --redact >/tmp/gl.$$ 2>&1; fi
  rc=$?
  if [ $rc -eq 0 ]; then say "gitleaks: OK"; else say "gitleaks: 秘密情報の疑いあり"; tail -30 /tmp/gl.$$; fail=1; fi
  rm -f /tmp/gl.$$
else say "gitleaks 未導入: 未確認(brew install gitleaks)"; unchecked=1; fi

[ $fail -eq 1 ] && { say "結果: 失敗(公開を止めること)"; exit 1; }
[ $unchecked -eq 1 ] && { say "結果: 一部未確認"; exit 2; }
say "結果: 問題なし"; exit 0
