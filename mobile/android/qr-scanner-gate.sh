#!/usr/bin/env bash
# PRINTER-SAFETY GATE for the native "Scan sticker QR" (Android versionCode 11). Run ONCE on the Mac,
# before the Play upload, from a checkout of the scanner branch (NOT from ~/Sellerflow, which stays on main):
#
#   git -C ~/Sellerflow fetch origin
#   git -C ~/Sellerflow worktree add ~/sfl-wt/qr-gate origin/claude/native-qr-scanner
#   bash ~/sfl-wt/qr-gate/mobile/android/qr-scanner-gate.sh
#
# It builds the release .aab TWICE, each in its own throw-away worktree under $TMPDIR:
#   main = origin/main      new = the commit this script was run from
# It never checks out, builds or writes anything in ~/Sellerflow or in the checkout it was run from
# (it only READS the signing key file and the Android SDK path from there). Then it prints PASS/FAIL for
#   a) chip types   b) native libraries (sha256 each)   c) printer code in the dex
#   d) library versions   e) merged manifest   f) size + 16 KB pages
# (details in qr-scanner-gate-check.mjs). Any FAIL → "STOP — do not release" + the reason.
# The report is saved to ~/Desktop/qr-scanner-gate-report.txt (or ~/ when there is no Desktop).
# Exit code 0 = PASS, 1 = FAIL, 2 = could not build or measure.
#
# Needs: git + git-lfs, Node + npm, Android Studio's SDK (build-tools for dexdump), Java.
# Optional: bundletool (brew install bundletool) for the per-phone download sizes.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAX_MB="${QR_GATE_MAX_MB:-6}"
BASE_REF="${QR_GATE_BASE:-origin/main}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sfl-qr-gate.XXXXXX")"
REPORT="$WORK/report.txt"
SAVE_DIR="$HOME/Desktop"; [ -d "$SAVE_DIR" ] || SAVE_DIR="$HOME"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
save_report() { cp "$REPORT" "$SAVE_DIR/qr-scanner-gate-report.txt" 2>/dev/null && echo "(report saved to $SAVE_DIR/qr-scanner-gate-report.txt)"; }
die() { say "CANNOT MEASURE: $*"; save_report; exit 2; }
cleanup() {
  for wt in "$WORK/main" "$WORK/new"; do git -C "$ROOT" worktree remove --force "$wt" >/dev/null 2>&1 || true; done
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v node >/dev/null || die "node not found"
command -v npm >/dev/null || die "npm not found"
command -v git >/dev/null || die "git not found"

# ── where things are (read only) ────────────────────────────────────────────────────────────
sdk_dir() {
  for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do [ -n "$d" ] && [ -d "$d" ] && { echo "$d"; return; }; done
  for f in "$ROOT/mobile/android/local.properties" "$HOME/Sellerflow/mobile/android/local.properties"; do
    [ -f "$f" ] && { sed -n 's/^sdk\.dir=//p' "$f" | head -1; return; }
  done
  [ -d "$HOME/Library/Android/sdk" ] && echo "$HOME/Library/Android/sdk"
}
SDK="$(sdk_dir)"
[ -n "$SDK" ] && [ -d "$SDK" ] || die "Android SDK not found (set ANDROID_HOME)"
DEXDUMP="$(ls -d "$SDK"/build-tools/*/dexdump 2>/dev/null | (sort -V 2>/dev/null || sort) | tail -1)"
[ -x "$DEXDUMP" ] || die "dexdump not found in $SDK/build-tools (install build-tools in Android Studio)"

KEYPROPS=""
for f in "$ROOT/mobile/android/keystore.properties" "$HOME/Sellerflow/mobile/android/keystore.properties"; do
  [ -f "$f" ] && { KEYPROPS="$f"; break; }
done
[ -n "$KEYPROPS" ] || die "keystore.properties not found (needed for the RELEASE build) — looked in this checkout and ~/Sellerflow/mobile/android"

say "SellerFlowLive — printer-safety gate for the native QR scanner ($(date '+%Y-%m-%d %H:%M'))"
git -C "$ROOT" fetch -q origin main || say "(git fetch failed — using the local $BASE_REF)"
MAIN_SHA="$(git -C "$ROOT" rev-parse "$BASE_REF")" || die "cannot read $BASE_REF"
NEW_SHA="$(git -C "$ROOT" rev-parse HEAD)" || die "cannot read this checkout's commit"
[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] && say "NOTE: this checkout has uncommitted changes — the gate builds the COMMIT $NEW_SHA, not them."
say "main = ${MAIN_SHA:0:8} ($BASE_REF)"
say "new  = ${NEW_SHA:0:8} ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD))"
say "build = bundleRelease (signed with $(basename "$KEYPROPS")) · dexdump = $DEXDUMP"
say ""

# ── two throw-away worktrees ────────────────────────────────────────────────────────────────
git -C "$ROOT" worktree add -q --detach "$WORK/main" "$MAIN_SHA" || die "git worktree add (main) failed"
git -C "$ROOT" worktree add -q --detach "$WORK/new" "$NEW_SHA" || die "git worktree add (new) failed"

prepare() { # $1 = worktree
  local wt="$1" lib
  if command -v git-lfs >/dev/null || git lfs version >/dev/null 2>&1; then git -C "$wt" lfs pull >/dev/null 2>&1 || true; fi
  for lib in "$wt"/mobile/android/app/libs/*.aar; do
    head -c 40 "$lib" | grep -q "git-lfs" && { echo "printer library $(basename "$lib") is a Git LFS pointer (git lfs pull failed)"; return 1; }
  done
  printf 'sdk.dir=%s\n' "$SDK" > "$wt/mobile/android/local.properties"
  # keystore.properties: same values, storeFile made absolute (it is read relative to mobile/android)
  local src_dir store
  src_dir="$(cd "$(dirname "$KEYPROPS")" && pwd)"
  store="$(sed -n 's/^storeFile=//p' "$KEYPROPS" | head -1)"
  case "$store" in /*) ;; *) store="$(cd "$src_dir" && cd "$(dirname "$store")" && pwd)/$(basename "$store")";; esac
  sed "s#^storeFile=.*#storeFile=$store#" "$KEYPROPS" > "$wt/mobile/android/keystore.properties"
  (cd "$wt/mobile" && npm ci --silent >/dev/null 2>&1 && npx cap sync android >/dev/null 2>&1) || { echo "npm ci / cap sync failed in $wt"; return 1; }
}
build() { # $1 = worktree, $2 = name → .aab, dependencies, manifest, merge report into $WORK/$2.*
  local wt="$1" n="$2" log="$WORK/gradle-$2.log"
  (cd "$wt/mobile/android" && ./gradlew --no-daemon -q clean bundleRelease >"$log" 2>&1) || { echo "bundleRelease failed — see $log"; return 1; }
  (cd "$wt/mobile/android" && ./gradlew --no-daemon -q :app:dependencies --configuration releaseRuntimeClasspath >"$WORK/$n.deps.txt" 2>>"$log") || { echo "dependencies failed — see $log"; return 1; }
  cp "$(ls "$wt"/mobile/android/app/build/outputs/bundle/release/*.aab | head -1)" "$WORK/$n.aab" || return 1
  cp "$(find "$wt/mobile/android/app/build/intermediates" -path '*merged_manifest*' -path '*release*' -name AndroidManifest.xml | head -1)" "$WORK/$n.manifest.xml" || { echo "merged manifest not found"; return 1; }
  local blame; blame="$(find "$wt/mobile/android/app/build" -name 'manifest-merger-blame-release-report.txt' | head -1)"
  [ -n "$blame" ] && cp "$blame" "$WORK/$n.blame.txt"
  return 0
}
step() { # $1 = what, rest = command; its messages go to the screen and the report
  local what="$1"; shift
  say "$what…"
  "$@" 2>&1 | tee -a "$REPORT"
  [ "${PIPESTATUS[0]}" = 0 ] || die "$what failed (see the line above)"
}
step "preparing main" prepare "$WORK/main"
step "preparing new" prepare "$WORK/new"
step "building main (release)" build "$WORK/main" main
step "building new (release)" build "$WORK/new" new

SIZE_ARGS=()
if command -v bundletool >/dev/null; then
  ok=1
  for k in main new; do
    bundletool build-apks --bundle="$WORK/$k.aab" --output="$WORK/$k.apks" --overwrite >/dev/null 2>&1 || ok=0
    [ "$ok" = 1 ] && { bundletool get-size total --apks="$WORK/$k.apks" --dimensions=ABI > "$WORK/$k.size.csv" 2>/dev/null || ok=0; }
  done
  [ "$ok" = 1 ] && SIZE_ARGS=(--main-size "$WORK/main.size.csv" --new-size "$WORK/new.size.csv")
fi
BLAME_ARGS=(); [ -f "$WORK/new.blame.txt" ] && BLAME_ARGS=(--new-blame "$WORK/new.blame.txt")

say ""
node "$ROOT/mobile/android/qr-scanner-gate-check.mjs" \
  --main-aab "$WORK/main.aab" --new-aab "$WORK/new.aab" \
  --main-deps "$WORK/main.deps.txt" --new-deps "$WORK/new.deps.txt" \
  --main-manifest "$WORK/main.manifest.xml" --new-manifest "$WORK/new.manifest.xml" \
  --main-libs "$WORK/main/mobile/android/app/libs" --new-libs "$WORK/new/mobile/android/app/libs" \
  --dexdump "$DEXDUMP" --max-mb "$MAX_MB" ${SIZE_ARGS[@]+"${SIZE_ARGS[@]}"} ${BLAME_ARGS[@]+"${BLAME_ARGS[@]}"} 2>&1 | tee -a "$REPORT"
code=${PIPESTATUS[0]}
save_report
exit "$code"
