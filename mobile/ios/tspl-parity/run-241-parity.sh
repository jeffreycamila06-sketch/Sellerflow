#!/usr/bin/env bash
# JVM parity test for the Android Phomemo 241 builder. Compiles the org.json
# stubs + the UNMODIFIED production TsplBuilder + Phomemo241Builder (pure — no
# android.graphics) + the test, then runs it. Proves the 241 fork's LAYOUT
# (rotate180(AIMO) for the 4 mirrored sizes + Jeff's v3 60x40 + BUG-1/2/3 +
# packBits). The glyph raster (Phomemo241Raster / android.graphics) is device-
# verified only and NOT compiled here. Run from anywhere:
#   mobile/ios/tspl-parity/run-241-parity.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SRC="$REPO/mobile/android/app/src/main/java/com/sellerflow/live"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

javac -encoding UTF-8 -d "$BUILD" \
  "$HERE/src/org/json/"*.java \
  "$SRC/TsplBuilder.java" \
  "$SRC/Phomemo241Builder.java" \
  "$HERE/src/com/sellerflow/live/Phomemo241ParityTest.java"

# -Dsfl.raster.src: Phomemo241Raster imports android.graphics so it cannot be
# compiled here; the P3.7 production-wiring pins read its SOURCE text instead.
java -Dfile.encoding=UTF-8 -Dsfl.raster.src="$SRC/Phomemo241Raster.java" \
  -Dsfl.plugin.src="$SRC/SellerFlowPrinterPlugin.java" \
  -cp "$BUILD" com.sellerflow.live.Phomemo241ParityTest
