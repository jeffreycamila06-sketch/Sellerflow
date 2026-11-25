#!/usr/bin/env bash
# Shows WHAT changed in each class the QR scanner gate listed under "c) printer code … CHANGED".
# Reads only the gate's own last build folder (in $TMPDIR) and its report on the Desktop; writes one
# file: ~/Desktop/qr-gate-class-diff.txt. Builds nothing, changes nothing in ~/Sellerflow.
#   git -C ~/Sellerflow show origin/main:scripts/qr-gate-class-diff.sh | bash
set -uo pipefail
# dexdump output holds raw bytes (Kotlin metadata); macOS awk/grep/sed stop on them unless the locale is plain C.
export LC_ALL=C LANG=C
REPORT="$HOME/Desktop/qr-scanner-gate-report.txt"
OUT="$HOME/Desktop/qr-gate-class-diff.txt"
[ -f "$REPORT" ] || { echo "no gate report on the Desktop — run the gate first"; exit 2; }
W="$(ls -td "${TMPDIR%/}"/sfl-qr-gate.*/ 2>/dev/null | head -1)"
[ -n "$W" ] && [ -f "$W/main.aab" ] && [ -f "$W/new.aab" ] || { echo "the gate's build folder (with main.aab + new.aab) was not found in \$TMPDIR"; exit 2; }
D="$(sed -n 's/.*dexdump = \([^ ]*\).*/\1/p' "$REPORT" | head -1)"
[ -x "$D" ] || { echo "dexdump not found ($D)"; exit 2; }
CLASSES="$(sed -n 's/^  CHANGED \(L[^ ]*;\).*/\1/p' "$REPORT")"
[ -n "$CLASSES" ] || { echo "the report lists no CHANGED class"; exit 0; }

for k in main new; do
  rm -rf "$W/x$k"; mkdir -p "$W/x$k"
  unzip -q -o "$W/$k.aab" 'base/dex/*' -d "$W/x$k"
  : > "$W/$k.dump.txt"
  for f in "$W/x$k"/base/dex/*.dex; do "$D" -d -a "$f" >> "$W/$k.dump.txt" 2>/dev/null; done
done

block() { # $1 = descriptor, $2 = dump → the class block, with offsets and table numbers taken out
  awk -v c="'$1'" 'index($0,"Class descriptor")&&index($0,c){p=1;print;next} /^Class #/{p=0} p' "$2" \
    | sed -E 's/^[0-9a-f]{6}: [0-9a-f ]*\|[0-9a-f]{4}: /| /; s/(string|type|method|field|call_site|proto)@[0-9a-f]+/\1@/g'
}
{
  echo "gate build folder: $W"
  echo "base = $(sed -n 's/^base = \([0-9a-f]*\).*/\1/p' "$REPORT")   new = $(sed -n 's/^new  = \([0-9a-f]*\).*/\1/p' "$REPORT")"
  for c in $CLASSES; do
    echo; echo "===================== $c"
    block "$c" "$W/main.dump.txt" > "$W/cls-main.txt"
    block "$c" "$W/new.dump.txt" > "$W/cls-new.txt"
    echo "lines: base $(wc -l < "$W/cls-main.txt")  new $(wc -l < "$W/cls-new.txt")"
    if [ ! -s "$W/cls-new.txt" ]; then
      echo "(not in the new build) — classes of the same kind in the new build:"
      grep -o "Class descriptor  : 'L[^']*ExternalSynthetic[^']*'" "$W/new.dump.txt" | sed "s/Class descriptor  : //" | grep -F "$(echo "$c" | sed 's/.*\$\$//; s/[0-9]*;$//')" | head -20
      echo "--- the base class:"; head -60 "$W/cls-main.txt"
    else
      diff -u "$W/cls-main.txt" "$W/cls-new.txt" | head -120
    fi
  done
} > "$OUT" 2>&1
echo "saved: $OUT ($(wc -l < "$OUT") lines)"
