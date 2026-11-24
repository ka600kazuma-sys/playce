#!/bin/bash
# ふりた本体(~/downloadtemp/furita/app)を、PLAYCEの public/furita にコピーする(同一オリジンで配信するため)。テスト用ファイルは除く。
set -euo pipefail
SRC="${1:-$HOME/downloadtemp/furita/app}"
DST="$(cd "$(dirname "$0")/.." && pwd)/public/furita"
mkdir -p "$DST"
find "$DST" -type f -delete
for f in "$SRC"/*; do case "$f" in *.test.js) ;; *) cp "$f" "$DST/";; esac; done
ls "$DST"
