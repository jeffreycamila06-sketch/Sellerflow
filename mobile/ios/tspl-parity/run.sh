#!/usr/bin/env bash
# Regenerate the Android TSPL golden fixtures from the UNMODIFIED production
# TsplBuilder.java. Requires a JDK (javac/java). Run from anywhere:
#   mobile/ios/tspl-parity/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
TSPL_SRC="$REPO/mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

javac -encoding UTF-8 -d "$BUILD" \
  "$HERE/src/org/json/"*.java \
  "$HERE/src/com/sellerflow/live/GoldenGen.java" \
  "$TSPL_SRC"

java -Dfile.encoding=UTF-8 -cp "$BUILD" com.sellerflow.live.GoldenGen "$HERE"
echo "Golden fixtures regenerated under $HERE/golden and $HERE/payloads"
