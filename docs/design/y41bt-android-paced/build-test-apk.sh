#!/usr/bin/env bash
# Builds a TEST app (debug) of THIS branch — the Y41BT paced send — to try on the Samsung A52.
# The test app loads the LIVE website (same as the store app); only the Android printer code is new.
#
# Run on the Mac, from a WORKTREE of the branch — never from ~/Sellerflow (it stays on main):
#
#   git -C ~/Sellerflow fetch origin
#   git -C ~/Sellerflow worktree add ~/sfl-wt/y41 origin/claude/compassionate-pasteur-at5au5
#   bash ~/sfl-wt/y41/docs/design/y41bt-android-paced/build-test-apk.sh
#
# What it writes: only inside the worktree (mobile/node_modules, mobile/android/local.properties, the
# Android build folders, the app's web folder made by `cap sync`), the printer libraries' Git LFS files in
# the .git folder the checkouts share, and ONE file on the Desktop: SellerFlowLive-Y41-test.apk.
# It installs nothing on a phone, signs nothing with the store key, and changes nothing in ~/Sellerflow.
#
# Needs: git + git-lfs, Node + npm, Android Studio's SDK, Java (the same things as a normal Android build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
J="mobile/android/app/src/main/java/com/sellerflow/live"
OUT="$HOME/Desktop/SellerFlowLive-Y41-test.apk"
LIVE_SITE="https://www.sellerflowlive.com"

die() { echo ""; echo "STOP: $*" >&2; exit 1; }
say() { echo "• $*"; }

[ "$ROOT" != "$HOME/Sellerflow" ] || die "this is ~/Sellerflow (it stays on main). Make the worktree first — see the top of this file."
cd "$ROOT"
grep -q 'NAME_PREFIXES = { "Y41BT" }' "$J/PacedBleSend.java" 2>/dev/null || die "this checkout does not have the Y41BT paced send ($J/PacedBleSend.java)."
say "checkout: $ROOT  ($(git rev-parse --short HEAD), $(git rev-parse --abbrev-ref HEAD))"

# 1 ── the printer libraries (Git LFS)
if git lfs version >/dev/null 2>&1; then git lfs pull >/dev/null 2>&1 || true; fi
for lib in mobile/android/app/libs/*.aar; do
  head -c 40 "$lib" | grep -q "git-lfs" && die "$(basename "$lib") is still a Git LFS pointer — install git-lfs (brew install git-lfs), then run this again."
done
say "printer libraries: ok"

# 2 ── the Android SDK
SDK=""
for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do [ -n "$d" ] && [ -d "$d" ] && { SDK="$d"; break; }; done
if [ -z "$SDK" ] && [ -f "$HOME/Sellerflow/mobile/android/local.properties" ]; then SDK="$(sed -n 's/^sdk\.dir=//p' "$HOME/Sellerflow/mobile/android/local.properties" | head -1)"; fi
[ -z "$SDK" ] && [ -d "$HOME/Library/Android/sdk" ] && SDK="$HOME/Library/Android/sdk"
[ -n "$SDK" ] && [ -d "$SDK" ] || die "Android SDK not found (open Android Studio once, or set ANDROID_HOME)."
printf 'sdk.dir=%s\n' "$SDK" > mobile/android/local.properties
say "Android SDK: $SDK"

# 3 ── the app shell's packages + config (inside the worktree only)
say "npm install + cap sync android (a few minutes the first time) ..."
( cd mobile && npm install --no-audit --no-fund >/tmp/y41-npm.log 2>&1 && npx cap sync android >>/tmp/y41-npm.log 2>&1 ) \
  || { tail -n 20 /tmp/y41-npm.log; die "npm install / cap sync failed (the last lines are above; the whole log: /tmp/y41-npm.log)"; }

# 4 ── the test app must load the LIVE website
CONFIG="mobile/android/app/src/main/assets/capacitor.config.json"
[ -f "$CONFIG" ] || die "$CONFIG is missing after cap sync."
grep -q "\"url\": *\"$LIVE_SITE" "$CONFIG" || die "the app would NOT load the live website (see \"url\" in $CONFIG). Nothing was built."
say "website the test app loads: $(grep -o '"url": *"[^"]*"' "$CONFIG" | head -1)"

# 5 ── the rules of the paced send, then the app
say "unit tests (PacedBleSendTest + the other Android printer tests) ..."
( cd mobile/android && ./gradlew --no-daemon -q testDebugUnitTest >/tmp/y41-test.log 2>&1 ) \
  || { grep -n -B2 -A14 "FAILED\|What went wrong" /tmp/y41-test.log | head -n 60; die "the Android unit tests failed (log: /tmp/y41-test.log). Nothing was built — send that text to Claude."; }
say "unit tests: passed"
say "building the test app (gradle clean assembleDebug) ..."
( cd mobile/android && ./gradlew --no-daemon -q clean assembleDebug >/tmp/y41-build.log 2>&1 ) \
  || { grep -n -A14 "What went wrong\|error:" /tmp/y41-build.log | head -n 60; die "the build failed (log: /tmp/y41-build.log) — send that text to Claude."; }
APK="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || die "no APK was made ($APK)."

# 6 ── look INSIDE the built app
unzip -p "$APK" 'classes*.dex' | grep -a -q "Lcom/sellerflow/live/PacedBleSend;" || die "the built app does not contain the paced send (PacedBleSend)."
unzip -p "$APK" assets/capacitor.config.json | grep -q "\"url\": *\"$LIVE_SITE" || die "the built app would not load the live website."
cp "$APK" "$OUT"

echo ""
echo "DONE: $OUT"
echo "  commit   $(git rev-parse HEAD)"
echo "  version  $(sed -n 's/^ *versionName "\(.*\)"/\1/p' mobile/android/app/build.gradle) (versionCode $(sed -n 's/^ *versionCode \([0-9]*\)/\1/p' mobile/android/app/build.gradle)) — debug build, not for the store"
echo ""
echo "Next (see docs/design/y41bt-android-paced/README.md, part 3):"
echo "  1. Save a log of the app that is on the A52 NOW (before removing it)."
echo "  2. adb uninstall com.sellerflow.live     (the test app has another signature; this logs the phone out)"
echo "  3. adb install \"$OUT\""
echo "  4. Log in, Printer settings, Scan, pick the row that ends with _LE, Test print — with the log running."
