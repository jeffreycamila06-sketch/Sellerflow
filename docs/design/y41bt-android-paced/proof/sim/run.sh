#!/usr/bin/env bash
# Runs the REAL Android sender (GenericBleTransport.java) of main and of this branch against a pretend phone
# and printer (fake/ — a model, NOT a real Samsung or a real Y41BT), on the plain JVM. Needs only javac + java.
#   bash docs/design/y41bt-android-paced/proof/sim/run.sh [base, default origin/main]
# Writes:
#   others-main.txt / others-branch.txt  — the full trace of every scenario for printers that are NOT a Y41BT.
#                                           The two files must be IDENTICAL (checked here).
#   y41-main.txt / y41-branch.txt        — the Y41BT scenarios before / after, with the checks.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
BASE="${1:-origin/main}"
J="mobile/android/app/src/main/java/com/sellerflow/live"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
unset JAVA_TOOL_OPTIONS || true

mkdir -p "$W/main-src/com/sellerflow/live" "$W/out-main" "$W/out-branch"
git -C "$ROOT" show "$BASE:$J/GenericBleTransport.java" > "$W/main-src/com/sellerflow/live/GenericBleTransport.java"
git -C "$ROOT" show "$BASE:$J/BleStickerLogic.java"     > "$W/main-src/com/sellerflow/live/BleStickerLogic.java"

FAKE=$(find "$HERE/fake" -name '*.java')
javac -encoding UTF-8 -nowarn -Xlint:none -d "$W/out-main"   $FAKE "$W"/main-src/com/sellerflow/live/*.java "$HERE/src/Sim.java"
javac -encoding UTF-8 -nowarn -Xlint:none -d "$W/out-branch" $FAKE "$ROOT/$J/GenericBleTransport.java" "$ROOT/$J/BleStickerLogic.java" "$ROOT/$J/PacedBleSend.java" "$HERE/src/Sim.java"

java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$W/out-main"   com.sellerflow.live.Sim others > "$HERE/others-main.txt"
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$W/out-branch" com.sellerflow.live.Sim others > "$HERE/others-branch.txt"
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$W/out-main"   com.sellerflow.live.Sim y41    > "$HERE/y41-main.txt"
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$W/out-branch" com.sellerflow.live.Sim y41    > "$HERE/y41-branch.txt"

echo "base: $BASE = $(git -C "$ROOT" rev-parse "$BASE")"
echo "scenarios for other printers: $(grep -c '^── ' "$HERE/others-main.txt")   trace lines: $(wc -l < "$HERE/others-main.txt")"
if cmp -s "$HERE/others-main.txt" "$HERE/others-branch.txt"; then
  echo "OTHER PRINTERS: main and the branch did exactly the same (the two traces are identical, sha256 $(sha256sum "$HERE/others-main.txt" | cut -c1-16)…)"
else
  echo "OTHER PRINTERS: DIFFERENT — see: diff $HERE/others-main.txt $HERE/others-branch.txt"; exit 1
fi
tail -1 "$HERE/y41-branch.txt"
