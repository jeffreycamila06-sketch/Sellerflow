#!/usr/bin/env bash
# ML Kit gate for the native "Scan sticker QR" (Android versionCode 11). Run on the Mac BEFORE the
# Play upload, from the checkout that holds the scanner branch:
#
#   bash mobile/android/qr-scanner-gate.sh
#
# It builds the app twice — main (before) and this checkout (after) — and prints PASS/FAIL for:
#   1. size       per-phone download growth (bundletool) ≤ QR_GATE_MAX_MB (default 6 MB);
#                 without bundletool: the .aab file growth
#   2. 16 KB      every NEW 64-bit native library (.so) has 16 KB-aligned load segments
#                 (Google Play's rule for Android 15+ apps); old libraries are listed as INFO
#   3. perms      the merged manifest gains NO permission, and no camera feature becomes required
#   4. minSdk     stays the same
# Then the merged-manifest permission list and every new .so, so the numbers can be read.
# Exit code 0 = all PASS, 1 = a FAIL, 2 = could not build/measure.
#
# Needs: Android Studio's SDK (ANDROID_HOME or mobile/android/local.properties), Node + npm,
# python3. Optional: bundletool (brew install bundletool) for the download sizes.
# Release signing is used when mobile/android/keystore.properties exists (else debug bundles are
# compared — the same libraries, the same growth). Nothing is uploaded; the worktree is removed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAX_MB="${QR_GATE_MAX_MB:-6}"
BASE_REF="${QR_GATE_BASE:-origin/main}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sfl-qr-gate.XXXXXX")"
BEFORE="$WORK/before"
REPORT="$WORK/report.txt"
fail=0

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
die() { say "CANNOT MEASURE: $*"; exit 2; }
cleanup() { git -C "$ROOT" worktree remove --force "$BEFORE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v python3 >/dev/null || die "python3 not found"
command -v npm >/dev/null || die "npm not found"

if [ -f "$ROOT/mobile/android/keystore.properties" ]; then TASK=bundleRelease; VARIANT=release; else TASK=bundleDebug; VARIANT=debug; fi
say "SellerFlowLive — native QR scanner gate ($(date '+%Y-%m-%d %H:%M'))"
say "after  = $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD))"
git -C "$ROOT" fetch -q origin main || say "(git fetch failed — using the local $BASE_REF)"
say "before = $(git -C "$ROOT" rev-parse --short "$BASE_REF") ($BASE_REF)"
say "build  = $TASK"
say ""

prepare() { # $1 = repo checkout
  local repo="$1"
  (cd "$repo/mobile" && { [ -d node_modules/@capacitor/android ] || npm ci --silent; }) || return 1
  if [ ! -d "$repo/mobile/android/capacitor-cordova-android-plugins" ]; then
    (cd "$repo/mobile" && npx cap sync android >/dev/null) || return 1
  fi
  if [ ! -f "$repo/mobile/android/local.properties" ] && [ -f "$ROOT/mobile/android/local.properties" ]; then
    cp "$ROOT/mobile/android/local.properties" "$repo/mobile/android/local.properties"
  fi
}

build() { # $1 = repo checkout → prints the .aab path
  local repo="$1"
  (cd "$repo/mobile/android" && ./gradlew -q clean "$TASK" >"$WORK/gradle-$(basename "$repo").log" 2>&1) || return 1
  ls "$repo/mobile/android/app/build/outputs/bundle/$VARIANT/"*.aab 2>/dev/null | head -1
}

git -C "$ROOT" worktree add -q --detach "$BEFORE" "$BASE_REF" || die "git worktree add failed"
if [ "$TASK" = bundleRelease ]; then
  ln -s "$ROOT/mobile/android/keystore.properties" "$BEFORE/mobile/android/keystore.properties"
  [ -e "$ROOT/keystore" ] && ln -s "$ROOT/keystore" "$BEFORE/keystore"
fi
[ -d "$ROOT/mobile/node_modules" ] && ln -s "$ROOT/mobile/node_modules" "$BEFORE/mobile/node_modules"

prepare "$ROOT" || die "could not prepare this checkout (npm ci / cap sync)"
prepare "$BEFORE" || die "could not prepare main (npm ci / cap sync)"
say "building main…";      AAB_BEFORE="$(build "$BEFORE")" || die "main did not build — see $WORK/gradle-before.log"
say "building scanner…";   AAB_AFTER="$(build "$ROOT")"    || die "this checkout did not build — see $WORK/gradle-$(basename "$ROOT").log"
[ -f "$AAB_BEFORE" ] && [ -f "$AAB_AFTER" ] || die "no .aab found"
cp "$AAB_BEFORE" "$WORK/before.aab"; cp "$AAB_AFTER" "$WORK/after.aab"

merged_manifest() { # $1 = repo
  find "$1/mobile/android/app/build/intermediates" -path "*merged_manifest*" -path "*$VARIANT*" -name AndroidManifest.xml 2>/dev/null | head -1
}
cp "$(merged_manifest "$BEFORE")" "$WORK/before-manifest.xml" 2>/dev/null || die "merged manifest (main) not found"
cp "$(merged_manifest "$ROOT")" "$WORK/after-manifest.xml" 2>/dev/null || die "merged manifest (scanner) not found"

# ── sizes ──────────────────────────────────────────────────────────────────────────────────
SIZE_LINE=""
SIZES_OK=0
if command -v bundletool >/dev/null; then
  SIZES_OK=1
  for k in before after; do
    bundletool build-apks --bundle="$WORK/$k.aab" --output="$WORK/$k.apks" --overwrite >/dev/null 2>&1 || SIZES_OK=0
    [ "$SIZES_OK" = 1 ] && { bundletool get-size total --apks="$WORK/$k.apks" --dimensions=ABI > "$WORK/$k-size.csv" 2>/dev/null || SIZES_OK=0; }
  done
fi
if [ "$SIZES_OK" = 1 ]; then
  SIZE_LINE="$(python3 - "$WORK/before-size.csv" "$WORK/after-size.csv" "$MAX_MB" <<'PY'
import csv, sys
def read(p):
    rows = list(csv.reader(open(p)))
    head = rows[0]; out = {}
    for r in rows[1:]:
        d = dict(zip(head, r)); out[d.get("ABI", "all")] = int(d["MAX"])
    return out
b, a, limit = read(sys.argv[1]), read(sys.argv[2]), float(sys.argv[3])
worst = 0
parts = []
for abi in sorted(a):
    grow = (a[abi] - b.get(abi, 0)) / 1e6
    worst = max(worst, grow)
    parts.append(f"{abi}: {b.get(abi, 0)/1e6:.1f} → {a[abi]/1e6:.1f} MB (+{grow:.1f})")
print(("PASS" if worst <= limit else "FAIL") + f" size: per-phone download +{worst:.1f} MB at most (limit {limit:g} MB) — " + "; ".join(parts))
PY
)"
else
  SIZE_LINE="$(python3 - "$WORK/before.aab" "$WORK/after.aab" "$MAX_MB" <<'PY'
import os, sys
b, a, limit = os.path.getsize(sys.argv[1]), os.path.getsize(sys.argv[2]), float(sys.argv[3])
grow = (a - b) / 1e6
print(("PASS" if grow <= limit else "FAIL") + f" size: .aab {b/1e6:.1f} → {a/1e6:.1f} MB (+{grow:.1f}, limit {limit:g} MB; install bundletool for per-phone sizes)")
PY
)"
fi

# ── 16 KB pages, permissions, minSdk ───────────────────────────────────────────────────────
CHECKS="$(python3 - "$WORK" <<'PY'
import re, struct, sys, zipfile
work = sys.argv[1]
PT_LOAD = 1
def so_list(aab):
    with zipfile.ZipFile(aab) as z:
        return {n: z.read(n) for n in z.namelist() if n.endswith(".so")}
def load_aligns(data):
    if data[:4] != b"\x7fELF": return None
    is64 = data[4] == 2
    end = "<" if data[5] == 1 else ">"
    if is64:
        phoff, = struct.unpack_from(end + "Q", data, 0x20); phentsize, phnum = struct.unpack_from(end + "HH", data, 0x36)
    else:
        phoff, = struct.unpack_from(end + "I", data, 0x1C); phentsize, phnum = struct.unpack_from(end + "HH", data, 0x2A)
    out = []
    for i in range(phnum):
        o = phoff + i * phentsize
        p_type, = struct.unpack_from(end + "I", data, o)
        if p_type != PT_LOAD: continue
        align, = struct.unpack_from(end + "Q", data, o + 0x30) if is64 else struct.unpack_from(end + "I", data, o + 0x1C)
        out.append(align)
    return is64, out
before, after = so_list(f"{work}/before.aab"), so_list(f"{work}/after.aab")
new = sorted(n for n in after if n not in before)
bad_new, info = [], []
for n in sorted(after):
    r = load_aligns(after[n])
    if r is None: continue
    is64, aligns = r
    ok = all(a >= 16384 for a in aligns)
    line = f"{n} ({len(after[n])/1e6:.2f} MB) align={min(aligns) if aligns else 0} {'ok' if ok else 'NOT 16 KB'}"
    if n in new:
        info.append("  NEW  " + line)
        if is64 and not ok: bad_new.append(n)
    elif is64 and not ok:
        info.append("  old  " + line + " (was already in main)")
print(("PASS" if not bad_new else "FAIL") + f" 16 KB: {len(new)} new native librar{'y' if len(new)==1 else 'ies'}, " + (f"{len(bad_new)} not aligned: {', '.join(bad_new)}" if bad_new else "all 64-bit ones aligned"))
def manifest(p):
    x = open(p, encoding="utf-8").read()
    perms = sorted(set(re.findall(r'<uses-permission(?:-sdk-23)?[^>]*android:name="([^"]+)"', x)))
    feats = {}
    for m in re.finditer(r'<uses-feature([^>]*)>', x):
        attrs = m.group(1)
        name = re.search(r'android:name="([^"]+)"', attrs)
        if not name: continue
        req = re.search(r'android:required="([^"]+)"', attrs)
        feats[name.group(1)] = (req.group(1) if req else "true")
    sdk = re.search(r'android:minSdkVersion="(\d+)"', x)
    return perms, feats, sdk.group(1) if sdk else "?"
pb, fb, sb = manifest(f"{work}/before-manifest.xml")
pa, fa, sa = manifest(f"{work}/after-manifest.xml")
added = [p for p in pa if p not in pb]
required = [f for f, r in fa.items() if r == "true" and fb.get(f) != "true"]
print(("PASS" if not added and not required else "FAIL") + " perms: " + (f"new permissions {added}" if added else "no new permission") + ("; newly REQUIRED features " + str(required) if required else ""))
print(("PASS" if sa == sb else "FAIL") + f" minSdk: {sb} → {sa}")
print("---")
print("permissions after: " + ", ".join(pa))
print("features after: " + ", ".join(f"{k} (required={v})" for k, v in sorted(fa.items())))
print("native libraries (new + old misaligned):")
print("\n".join(info) if info else "  (none)")
PY
)"

say "$SIZE_LINE"
printf '%s\n' "$CHECKS" | tee -a "$REPORT"
say ""
if printf '%s\n%s\n' "$SIZE_LINE" "$CHECKS" | grep -q '^FAIL'; then fail=1; fi
if [ "$fail" = 0 ]; then say "RESULT: PASS — ML Kit is fine for this upload."; else say "RESULT: FAIL — do not upload; send this report back (ZXing is the fallback)."; fi
cp "$REPORT" "$ROOT/qr-scanner-gate-report.txt" 2>/dev/null && say "(report saved to qr-scanner-gate-report.txt in the repo folder — not committed)"
exit "$fail"
