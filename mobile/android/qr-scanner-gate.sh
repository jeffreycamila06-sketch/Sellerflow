#!/usr/bin/env bash
# PRINTER-SAFETY GATE for the native "Scan sticker QR" (Android versionCode 11). Run ONCE on the Mac,
# before the Play upload, from a checkout of the EXACT commit you will upload (a worktree — not from
# ~/Sellerflow, which stays on main):
#
#   git -C ~/Sellerflow fetch origin
#   git -C ~/Sellerflow worktree add ~/sfl-wt/qr-gate origin/claude/native-qr-scanner
#   bash ~/sfl-wt/qr-gate/mobile/android/qr-scanner-gate.sh
#   bash ~/sfl-wt/qr-gate/mobile/android/qr-scanner-gate.sh --commits   (only print the two commits, build nothing)
#
# What it compares:
#   base = the newest commit of origin/main that does NOT contain SellerFlowScannerPlugin.java
#          (found with git log --first-parent; = origin/main itself until the scanner is merged)
#   new  = HEAD of the checkout this script was run from (the commit to upload); it MUST contain the scanner
# Both commit ids are printed. Then:
#   1. the mobile/ BYTE PIN of the source (SCANNER_GATE=1 node scripts/native-scanner-fence.mjs --check
#      --base <base>): every mobile/ file = the base's, except the scanner's lines and files;
#   2. the RELEASE .aab of both, each built in its own throw-away worktree under $TMPDIR;
#   3. qr-scanner-gate-check.mjs: a) chip types  b) native libraries (sha256 each)  c) printer code in the
#      dex (code + annotations)  d) library versions  e) the whole merged manifest  g) every other file
#      in the .aab  f) size + 16 KB pages.
# Any FAIL → "STOP — do not release" + the reason. Anything it cannot measure → "CANNOT MEASURE — STOP".
# The report is saved to ~/Desktop/qr-scanner-gate-report.txt (or ~/ when there is no Desktop).
# Exit code 0 = PASS, 1 = FAIL, 2 = CANNOT MEASURE — STOP.
#
# What it WRITES, honestly:
#   - in the .git folder the checkouts share (~/Sellerflow/.git): `git fetch origin main` (updates
#     origin/main and adds the objects it downloads), two `git worktree add` entries under
#     .git/worktrees/ (removed again by `git worktree remove` when the script ends), and the Git LFS
#     files of both commits under .git/lfs/objects/ (`git lfs pull` — the Niimbot printer libraries).
#   - its two worktrees under $TMPDIR (removed at the end), its build files (.aab, logs) in a folder under
#     $TMPDIR (kept, the path is printed — delete it when done), and the report file above.
#   It never checks out, builds or edits anything in ~/Sellerflow's own working files, and never runs
#   `git worktree prune`. If the script is killed before the end, the two worktree entries may stay —
#   `git -C ~/Sellerflow worktree list` shows them; `git -C ~/Sellerflow worktree prune` removes them.
#   The signing key (keystore.properties and the keystore it names) is only READ: a copy of
#   keystore.properties with the keystore's full path is written into each throw-away worktree.
#
# Needs: git + git-lfs, Node + npm, Android Studio's SDK (build-tools for dexdump), Java.
# Optional: bundletool (brew install bundletool) for the per-phone download sizes.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAX_MB="${QR_GATE_MAX_MB:-6}"
BASE_REF="${QR_GATE_BASE:-origin/main}"
SCANNER_FILE="mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sfl-qr-gate.XXXXXX")"
REPORT="$WORK/report.txt"
SAVE_DIR="$HOME/Desktop"; [ -d "$SAVE_DIR" ] || SAVE_DIR="$HOME"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
save_report() { cp "$REPORT" "$SAVE_DIR/qr-scanner-gate-report.txt" 2>/dev/null && echo "(report saved to $SAVE_DIR/qr-scanner-gate-report.txt)"; }
die() { say "CANNOT MEASURE — STOP: $*"; save_report; exit 2; }
cleanup() {
  for wt in "$WORK/main" "$WORK/new"; do
    [ -d "$wt" ] && git -C "$ROOT" worktree remove --force "$wt" >/dev/null 2>&1
  done
  return 0
}
trap cleanup EXIT

command -v node >/dev/null || die "node not found"
command -v npm >/dev/null || die "npm not found"
command -v git >/dev/null || die "git not found"

say "SellerFlowLive — printer-safety gate for the native QR scanner ($(date '+%Y-%m-%d %H:%M'))"
git -C "$ROOT" fetch -q origin main || say "(git fetch failed — using the local $BASE_REF)"

# ── the two commits ─────────────────────────────────────────────────────────────────────────
NEW_SHA="$(git -C "$ROOT" rev-parse HEAD)" || die "cannot read this checkout's commit"
git -C "$ROOT" cat-file -e "$NEW_SHA:$SCANNER_FILE" 2>/dev/null || die "this commit (${NEW_SHA:0:8}) has no $SCANNER_FILE — run the gate from the commit you will upload"
BASE_SHA=""
for c in $(git -C "$ROOT" log --first-parent --format=%H -n 5000 "$BASE_REF" 2>/dev/null); do
  if ! git -C "$ROOT" cat-file -e "$c:$SCANNER_FILE" 2>/dev/null; then BASE_SHA="$c"; break; fi
done
[ -n "$BASE_SHA" ] || die "no commit of $BASE_REF without the scanner was found"
[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] && say "NOTE: this checkout has uncommitted changes — the gate builds the COMMIT ${NEW_SHA:0:8}, not them."
git -C "$ROOT" merge-base --is-ancestor "$BASE_SHA" "$NEW_SHA" || say "NOTE: the base is not inside the new commit's history — merge main into it first, or main's own newer changes will show as FAIL."
say "base = $BASE_SHA  (newest $BASE_REF commit without the scanner)"
say "new  = $NEW_SHA  (this checkout, $(git -C "$ROOT" rev-parse --abbrev-ref HEAD))"

if [ "${1:-}" = "--commits" ]; then save_report; exit 0; fi

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
say "build = bundleRelease (signed with $(basename "$KEYPROPS"), only read) · dexdump = $DEXDUMP · build files in $WORK"
say ""


# ── two throw-away worktrees ────────────────────────────────────────────────────────────────
git -C "$ROOT" worktree add -q --detach "$WORK/main" "$BASE_SHA" || die "git worktree add (base) failed"
git -C "$ROOT" worktree add -q --detach "$WORK/new" "$NEW_SHA" || die "git worktree add (new) failed"

step() { # $1 = what, rest = command; its messages go to the screen and the report
  local what="$1"; shift
  say "${what}…"
  "$@" 2>&1 | tee -a "$REPORT"
  return "${PIPESTATUS[0]}"
}

# 1. the source byte pin (fast — before the long builds)
pin() { (cd "$WORK/new" && SCANNER_GATE=1 node scripts/native-scanner-fence.mjs --check --base "$BASE_SHA"); }
step "mobile/ byte pin of the source (SCANNER_GATE=1)" pin
pin_code=$?
if [ "$pin_code" = 1 ]; then say ""; say "STOP — do not release. The mobile/ source has changes beyond the scanner (listed above)."; save_report; exit 1; fi
[ "$pin_code" = 0 ] || die "the mobile/ byte pin could not run (exit $pin_code)"
say ""

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
  # mobile/package-lock.json has been out of step with package.json since the iOS StatusBar commit
  # (npm ci refuses). Both builds use the SAME plain `npm install`: it keeps the lock's pinned versions
  # (typescript 6.0.3 — the unpinned "latest" breaks cap's config loader) and may only touch the lock
  # inside this throw-away worktree, never in ~/Sellerflow.
  local plog="$WORK/prepare-$(basename "$wt").log"
  (cd "$wt/mobile" && npm install --no-audit --no-fund >"$plog" 2>&1 && npx cap sync android >>"$plog" 2>&1) \
    || { echo "npm install / cap sync failed in $wt — last lines:"; tail -n 15 "$plog"; return 1; }
}
build() { # $1 = worktree, $2 = name → .aab, dependencies, manifest, merge report into $WORK/$2.*
  local wt="$1" n="$2" log="$WORK/gradle-$2.log"
  (cd "$wt/mobile/android" && ./gradlew --no-daemon -q clean bundleRelease >"$log" 2>&1) || { echo "bundleRelease failed — see $log — the error:"; grep -n -A12 "What went wrong" "$log" | head -n 40 || tail -n 30 "$log"; return 1; }
  (cd "$wt/mobile/android" && ./gradlew --no-daemon -q :app:dependencies --configuration releaseRuntimeClasspath >"$WORK/$n.deps.txt" 2>>"$log") || { echo "dependencies failed — see $log"; return 1; }
  cp "$(ls "$wt"/mobile/android/app/build/outputs/bundle/release/*.aab | head -1)" "$WORK/$n.aab" || return 1
  cp "$(find "$wt/mobile/android/app/build/intermediates" -path '*merged_manifest*' -path '*release*' -name AndroidManifest.xml | head -1)" "$WORK/$n.manifest.xml" || { echo "merged manifest not found"; return 1; }
  local blame; blame="$(find "$wt/mobile/android/app/build" -name 'manifest-merger-blame-release-report.txt' | head -1)"
  [ -n "$blame" ] && cp "$blame" "$WORK/$n.blame.txt"
  return 0
}
step "preparing the base" prepare "$WORK/main" || die "preparing the base failed (see the line above)"
step "preparing new" prepare "$WORK/new" || die "preparing new failed (see the line above)"
step "building the base (release)" build "$WORK/main" main || die "building the base failed (see the line above)"
step "building new (release)" build "$WORK/new" new || die "building new failed (see the line above)"

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
node "$WORK/new/mobile/android/qr-scanner-gate-check.mjs" \
  --main-aab "$WORK/main.aab" --new-aab "$WORK/new.aab" \
  --main-deps "$WORK/main.deps.txt" --new-deps "$WORK/new.deps.txt" \
  --main-manifest "$WORK/main.manifest.xml" --new-manifest "$WORK/new.manifest.xml" \
  --main-libs "$WORK/main/mobile/android/app/libs" --new-libs "$WORK/new/mobile/android/app/libs" \
  --dexdump "$DEXDUMP" --max-mb "$MAX_MB" ${SIZE_ARGS[@]+"${SIZE_ARGS[@]}"} ${BLAME_ARGS[@]+"${BLAME_ARGS[@]}"} 2>&1 | tee -a "$REPORT"
code=${PIPESTATUS[0]}
# Fail closed: exit 0 counts only when the checker really printed its PASS verdict.
if [ "$code" = 0 ] && ! grep -q "^RESULT: PASS" "$REPORT"; then
  say "CANNOT MEASURE — STOP: the checker printed no verdict"
  code=2
fi
save_report
exit "$code"
