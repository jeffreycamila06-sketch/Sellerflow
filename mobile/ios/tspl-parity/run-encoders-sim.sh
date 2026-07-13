#!/usr/bin/env bash
# PRE-ARCHIVE GATE for the CJK printer encoders (Build 7 / v1.3 GBK fix).
#
# WHY: the 2026-07-13 bug — GBK_95's converter is missing on real iOS, so every
# Chinese buyer name printed as '?' — was invisible to Mac-run tests because
# macOS ships the converter. This script compiles the CjkEncoding block from
# the UNMODIFIED production plugin source and runs its fixture tests INSIDE an
# iOS Simulator (the iOS runtime's Foundation/ICU — same converter availability
# as a device). Run on the Mac BEFORE every Archive:
#
#   mobile/ios/tspl-parity/run-encoders-sim.sh            # first available iPhone sim
#   mobile/ios/tspl-parity/run-encoders-sim.sh "iPhone 15"  # specific device
#
# GREEN  → converters verified on the iOS runtime; safe to Archive.
# RED    → if the [CJK-ENV] line shows a whole family unavailable, STOP the
#          release: that is the Contingency C trigger (embedded Unicode→GBK
#          table — separate plan + audit). Any other failure = encoder bug.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$HERE/../App/App/SellerFlowPrinterPlugin.swift"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

# 1. Extract the CjkEncoding block VERBATIM from the production source (the
#    markers guarantee we test the shipping code, not a copy that can drift).
sed -n '/^\/\/ CJK-ENCODING-BEGIN/,/^\/\/ CJK-ENCODING-END/p' "$PLUGIN" > "$BUILD/CjkEncoding.swift"
if ! grep -q "enum CjkEncoding" "$BUILD/CjkEncoding.swift"; then
  echo "FAIL: could not extract CjkEncoding from $PLUGIN (markers moved?)" >&2
  exit 1
fi
{ echo "import Foundation"; cat "$BUILD/CjkEncoding.swift"; } > "$BUILD/CjkEncodingSrc.swift"

# 2. Assert-style main — the SAME fixtures as CjkEncodingTests.swift.
#    (Derivation: python3 -c "print('北部還有嗎'.encode('gbk').hex(' '))" etc.;
#    gbk==gb18030 and big5==cp950 hold for every fixture char.)
cat > "$BUILD/main.swift" <<'SWIFT'
import Foundation

var failures = 0
func eq(_ name: String, _ got: [UInt8], _ want: [UInt8]) {
    if got == want { print("PASS \(name)") }
    else {
        failures += 1
        print("FAIL \(name)\n  want: \(want.map { String(format: "%02x", $0) }.joined(separator: " "))\n  got:  \(got.map { String(format: "%02x", $0) }.joined(separator: " "))")
    }
}
func eqInt(_ name: String, _ got: Int, _ want: Int) {
    if got == want { print("PASS \(name)") } else { failures += 1; print("FAIL \(name) want \(want) got \(got)") }
}

// Environment report + Contingency-C gate
let gbkAvail = CjkEncoding.nsEncoding(.GBK_95) != nil
let gb18030Avail = CjkEncoding.nsEncoding(.GB_18030_2000) != nil
let big5Avail = CjkEncoding.nsEncoding(.big5) != nil
let cp950Avail = CjkEncoding.nsEncoding(.dosChineseTrad) != nil
print("[CJK-ENV] GBK_95=\(gbkAvail) GB18030=\(gb18030Avail) big5=\(big5Avail) CP950=\(cp950Avail)")
if !(gbkAvail || gb18030Avail) { failures += 1; print("FAIL no GBK-family converter — CONTINGENCY C") }
if !(big5Avail || cp950Avail) { failures += 1; print("FAIL no Big5-family converter — CONTINGENCY C") }

// gbkBytes — sticker (Java getBytes("GBK") parity)
eq("gbk 北部還有嗎 (the production bug string)",
   CjkEncoding.gbkBytes("\u{5317}\u{90E8}\u{9084}\u{6709}\u{55CE}"),
   [0xB1, 0xB1, 0xB2, 0xBF, 0xDF, 0x80, 0xD3, 0xD0, 0x86, 0xE1])
eq("gbk 陳小美 (test-page probe)",
   CjkEncoding.gbkBytes("\u{9673}\u{5C0F}\u{7F8E}"),
   [0xEA, 0x90, 0xD0, 0xA1, 0xC3, 0xC0])
eq("gbk mixed A陳b", CjkEncoding.gbkBytes("A\u{9673}b"), [0x41, 0xEA, 0x90, 0x62])
eq("gbk pure ASCII identity", CjkEncoding.gbkBytes("Buyer #12"), Array("Buyer #12".utf8))
eq("gbk U+07C0 not-in-GBK → single '?' (4-byte GB18030 rejected)",
   CjkEncoding.gbkBytes("\u{07C0}"), [0x3F])
eq("gbk 陳+U+07C0+美 → '?' only for the unmappable char",
   CjkEncoding.gbkBytes("\u{9673}\u{07C0}\u{7F8E}"), [0xEA, 0x90, 0x3F, 0xC3, 0xC0])

// big5Bytes — receipt (Android Big5 + stripUnencodable parity: DROP)
eq("big5 北部還有嗎",
   CjkEncoding.big5Bytes("\u{5317}\u{90E8}\u{9084}\u{6709}\u{55CE}"),
   [0xA5, 0x5F, 0xB3, 0xA1, 0xC1, 0xD9, 0xA6, 0xB3, 0xB6, 0xDC])
eq("big5 陳小美", CjkEncoding.big5Bytes("\u{9673}\u{5C0F}\u{7F8E}"),
   [0xB3, 0xAF, 0xA4, 0x70, 0xAC, 0xFC])
eq("big5 mixed A陳b", CjkEncoding.big5Bytes("A\u{9673}b"), [0x41, 0xB3, 0xAF, 0x62])
eq("big5 简 dropped (Android parity — no '?', no garbage)",
   CjkEncoding.big5Bytes("\u{9673}\u{7B80}\u{7F8E}"), [0xB3, 0xAF, 0xAC, 0xFC])
eq("big5 pure ASCII identity", CjkEncoding.big5Bytes("Total: 150"), Array("Total: 150".utf8))

// buildNumberLiteral — getBuildNumber shim source
eqInt("buildNumber '7' → 7", CjkEncoding.buildNumberLiteral(from: "7"), 7)
eqInt("buildNumber nil → 0", CjkEncoding.buildNumberLiteral(from: nil), 0)
eqInt("buildNumber '7.0' → 0 (omit line)", CjkEncoding.buildNumberLiteral(from: "7.0"), 0)
eqInt("buildNumber '0' → 0", CjkEncoding.buildNumberLiteral(from: "0"), 0)
eqInt("buildNumber '-3' → 0", CjkEncoding.buildNumberLiteral(from: "-3"), 0)

if failures > 0 { print("\n\(failures) FAILURE(S) — DO NOT ARCHIVE"); exit(1) }
print("\nALL GREEN on the iOS runtime — safe to Archive")
SWIFT

# 3. Compile for the iOS Simulator (the iOS runtime, NOT macOS).
ARCH="$(uname -m)"          # arm64 on Apple Silicon, x86_64 on Intel
TARGET="${ARCH}-apple-ios15.0-simulator"
xcrun -sdk iphonesimulator swiftc -target "$TARGET" \
  "$BUILD/CjkEncodingSrc.swift" "$BUILD/main.swift" -o "$BUILD/cjk-encoder-tests"

# 4. Find (or boot) a simulator and run inside it.
WANTED="${1:-}"
booted_udid() { xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1; }
UDID="$(booted_udid || true)"
if [ -z "$UDID" ]; then
  if [ -n "$WANTED" ]; then
    UDID="$(xcrun simctl list devices available | grep -F "$WANTED (" | grep -oE '[0-9A-F-]{36}' | head -1)"
  else
    UDID="$(xcrun simctl list devices available | grep -E 'iPhone' | grep -oE '[0-9A-F-]{36}' | head -1)"
  fi
  if [ -z "$UDID" ]; then echo "FAIL: no available iPhone simulator found" >&2; exit 1; fi
  echo "Booting simulator $UDID ..."
  xcrun simctl boot "$UDID"
  BOOTED_BY_SCRIPT=1
else
  BOOTED_BY_SCRIPT=0
fi

set +e
xcrun simctl spawn "$UDID" "$BUILD/cjk-encoder-tests"
RESULT=$?
set -e
if [ "$BOOTED_BY_SCRIPT" = "1" ]; then xcrun simctl shutdown "$UDID" || true; fi
exit $RESULT
