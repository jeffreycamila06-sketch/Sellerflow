#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ANDROID TEST-APK BUILDER — deterministic branch-web testing on a real device.
#
# WHY THIS SCRIPT EXISTS (2026-07-18 "old UI" incident): the manual pipeline
# (build → hand-copy dist → hand-edit capacitor.config.json → gradle) has a
# LANDMINE at every step, and one of them shipped Jeff an APK that showed the
# OLD app even though the new bundle was inside it:
#   • `npx cap sync android` copies webDir = mobile/www — an ANCIENT committed
#     web snapshot (pre-redesign, index-D6ZnYiqt.js era) — over
#     android/app/src/main/assets/public, AND restores server.url into
#     assets/capacitor.config.json. Any sync in the flow silently reverts you
#     to a stale bundle and/or the production thin shell.
#   • A partial copy (e.g. only dist/assets/*) leaves assets/public/index.html
#     pointing at a DIFFERENT hashed main-*.js than the one you verified —
#     the APK "contains the new code" but never loads it.
#   • Hand-editing assets/capacitor.config.json is easy to do in the wrong
#     order (before a sync that rewrites it).
#   • An incremental gradle build after mass-replacing assets can package
#     stale merged assets; `clean` closes that hole.
# This script does the whole pipeline atomically and then VERIFIES INSIDE THE
# BUILT APK that (a) the config is what the mode requires and (b) the
# index.html actually references a bundle file that exists in the APK.
# NEVER run `npx cap sync android` after this script (it undoes everything).
#
# MODES
#   ./build-android-testapk.sh bundle
#       Offline LOCAL BUNDLE: packages the CURRENT repo build into the APK
#       (origin https://localhost). Real TikTok connect works (localhost is in
#       Render's allow-list) — ⚠️ but ONLY if .env holds all three VITE vars
#       (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/ANON_KEY,
#       VITE_SERVER_URL) — they are baked at build time (see CLAUDE.md).
#   ./build-android-testapk.sh url https://<branch-preview>.vercel.app
#       THIN SHELL to any HTTPS URL (e.g. the Vercel BRANCH PREVIEW): fastest
#       way to test branch UI + native printing on-device with zero bundling —
#       the WebView loads the live preview; the native printer bridge works
#       from any origin. ⚠️ TikTok connect will NOT work on a *.vercel.app
#       origin (Render CLIENT_ORIGIN CORS) — UI/printing testing only.
#       (No plain http:// URLs — the manifest has no cleartext permission.)
#
# ENV
#   SKIP_GRADLE=1   stop after staging+verify (no Android SDK needed) — the
#                   gradle+APK-verify steps then run on the Mac.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${1:-bundle}"
URL="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # mobile/
REPO="$(cd "$HERE/.." && pwd)"
PUBLIC="$HERE/android/app/src/main/assets/public"
CONFIG="$HERE/android/app/src/main/assets/capacitor.config.json"
APK="$HERE/android/app/build/outputs/apk/debug/app-debug.apk"

fail() { echo "✗ $1" >&2; exit 1; }
note() { echo "• $1"; }

if [ "$MODE" = "url" ]; then
  [ -n "$URL" ] || fail "url mode needs a URL: ./build-android-testapk.sh url https://..."
  case "$URL" in https://*) ;; *) fail "only https:// URLs (no cleartext permission in the manifest)";; esac
elif [ "$MODE" != "bundle" ]; then
  fail "unknown mode '$MODE' (use: bundle | url <https-url>)"
fi

# 1 ── Build the CURRENT repo web (bundle mode bakes .env at this step).
if [ "$MODE" = "bundle" ]; then
  note "building web (npm run build) ..."
  ( cd "$REPO" && rm -rf dist && npm run build >/dev/null )
  [ -f "$REPO/dist/index.html" ] || fail "dist/index.html missing after build"
  grep -q 'id="redesign-root"' "$REPO/dist/index.html" \
    || fail "dist/index.html is NOT the redesign entry (found no redesign-root)"
  # The iOS local-bundle lesson: a bundle without VITE_SERVER_URL points the
  # socket at http://localhost:3001 → 'Can't reach the live server' on device.
  if grep -rqs "localhost:3001" "$REPO/dist/assets/"; then
    echo "⚠️  dist bakes localhost:3001 — .env is missing VITE_SERVER_URL;"
    echo "    TikTok connect will FAIL on the device (UI/printing still testable)."
  fi
fi

# 2 ── Stage assets/public atomically (full wipe + full copy — never partial).
if [ "$MODE" = "bundle" ]; then
  note "staging dist -> assets/public ..."
  rm -rf "$PUBLIC"
  mkdir -p "$PUBLIC"
  cp -R "$REPO/dist/." "$PUBLIC/"
fi
[ -f "$PUBLIC/index.html" ] || fail "assets/public/index.html missing (in url mode run 'bundle' once first, or npx cap sync, so the packaged fallback exists)"

# 3 ── Write assets/capacitor.config.json FRESH (never hand-edit it).
note "writing assets/capacitor.config.json ($MODE mode) ..."
if [ "$MODE" = "bundle" ]; then
  cat > "$CONFIG" <<'JSON'
{
  "appId": "com.sellerflow.live",
  "appName": "SellerFlow",
  "webDir": "www",
  "android": { "includePlugins": [] },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 900,
      "backgroundColor": "#f5f3ef",
      "androidScaleType": "CENTER_CROP",
      "showSpinner": false
    }
  }
}
JSON
else
  cat > "$CONFIG" <<JSON
{
  "appId": "com.sellerflow.live",
  "appName": "SellerFlow",
  "webDir": "www",
  "server": { "url": "$URL", "cleartext": false, "androidScheme": "https" },
  "android": { "includePlugins": [] },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 900,
      "backgroundColor": "#f5f3ef",
      "androidScaleType": "CENTER_CROP",
      "showSpinner": false
    }
  }
}
JSON
fi
python3 -m json.tool "$CONFIG" >/dev/null || fail "generated config is not valid JSON"

# 4 ── Pre-gradle verification: the index/bundle chain must be consistent.
ENTRY_JS="$(grep -o 'assets/main-[^"]*\.js' "$PUBLIC/index.html" | head -1 || true)"
[ -n "$ENTRY_JS" ] || fail "assets/public/index.html references no assets/main-*.js — STALE/ANCIENT index (this is the 'old UI' bug)"
[ -f "$PUBLIC/$ENTRY_JS" ] || fail "index.html references $ENTRY_JS but the file is NOT in assets/public — partial copy (this is the 'old UI' bug)"
if [ "$MODE" = "bundle" ]; then
  grep -q '"server"' "$CONFIG" && fail "bundle mode but config has a server block"
  note "verified: index.html -> $ENTRY_JS (present), config = local bundle"
else
  note "verified: config server.url = $URL (packaged web is only the offline fallback)"
fi

# 5 ── Gradle (CLEAN build — incremental asset staleness is a real failure mode).
if [ "${SKIP_GRADLE:-0}" = "1" ]; then
  note "SKIP_GRADLE=1 — staging verified; run on the Mac:  cd mobile/android && ./gradlew clean assembleDebug"
  exit 0
fi
note "gradle clean assembleDebug ..."
( cd "$HERE/android" && ./gradlew clean assembleDebug )
[ -f "$APK" ] || fail "APK not produced: $APK"

# 6 ── POST-BUILD verification INSIDE the APK (the authoritative check).
note "verifying inside the APK ..."
APK_CONFIG="$(unzip -p "$APK" assets/capacitor.config.json)"
if [ "$MODE" = "bundle" ]; then
  echo "$APK_CONFIG" | grep -q '"server"' && fail "APK config still has a server block — the WebView would load a REMOTE url, not your bundle"
else
  echo "$APK_CONFIG" | grep -qF "$URL" || fail "APK config does not carry the requested url"
fi
APK_ENTRY_JS="$(unzip -p "$APK" assets/public/index.html | grep -o 'assets/main-[^"]*\.js' | head -1 || true)"
[ -n "$APK_ENTRY_JS" ] || fail "APK index.html references no main-*.js — stale index packaged"
unzip -l "$APK" | grep -q "assets/public/$APK_ENTRY_JS" \
  || fail "APK index.html references $APK_ENTRY_JS but that file is not packaged"
note "APK verified: index.html -> $APK_ENTRY_JS (packaged), config = $MODE"
echo
echo "✅ $APK"
echo "   install:  adb install -r \"$APK\"   (or send the file to the phone)"
[ "$MODE" = "bundle" ] || echo "   loads:    $URL  (thin shell; TikTok connect blocked by CORS on previews)"
