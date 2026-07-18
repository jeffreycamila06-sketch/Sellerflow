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

# ── CLOSURE VERIFY (the packaging-correctness core) ──────────────────────────
# A modern Vite build's index.html references MORE than one hashed asset — the
# entry chunk (main-*.js), any code-split chunk (e.g. db-*.js), and the CSS.
# The "index references X but X is not packaged" failure happens when index.html
# and the asset files fall out of sync (a partial/interrupted copy, a leftover
# stale assets/public from a prior run or a stray `npx cap sync`, a
# case-insensitive-FS hash clash, …). Checking only the first main-*.js misses a
# dropped db-*.js/CSS entirely. This verifies the COMPLETE closure: every local
# /assets/* reference in index.html must resolve to a real file under <root>.
# Runs POST-STAGE (before the expensive gradle — fails fast with the exact
# missing file) and again INSIDE the APK. Since gradle packages src/main/assets
# verbatim, a staged tree that passes closure ⟹ a consistent APK.
#   assert_closure <index.html path> <asset-root dir> <label>
assert_closure() {
  local index="$1" root="$2" label="$3" ref rel missing=0
  [ -f "$index" ] || fail "$label: index.html missing at $index"
  local refs; refs="$(grep -oE '(src|href)="[^"]*/assets/[^"]*\.(js|css)"' "$index" \
                      | sed -E 's/.*"([^"]*)".*/\1/' | sed -E 's#^.*/assets/#assets/#' | sort -u)"
  [ -n "$refs" ] || fail "$label: index.html references NO /assets/*.js|css — stale/ancient index (the 'old UI' bug)"
  echo "$refs" | grep -q 'assets/main-.*\.js' \
    || fail "$label: index.html has no main-*.js entry chunk — stale/ancient index"
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    if [ ! -f "$root/$ref" ]; then echo "   MISSING: $ref" >&2; missing=1; fi
  done <<< "$refs"
  [ "$missing" -eq 0 ] || fail "$label: index.html references asset(s) NOT present (above) — inconsistent bundle; re-run this script (it clean-stages) rather than shipping"
  note "$label closure OK — $(echo "$refs" | wc -l | tr -d ' ') asset(s), all present"
}

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

# 2 ── Stage assets/public DETERMINISTICALLY (clean swap — never a merge into a
# stale tree). Copy into a fresh sibling dir then atomically replace, so a
# leftover assets/public from a prior run / stray `npx cap sync` can never
# survive to mingle with the new bundle (the root cause of an index that
# references a hash whose file isn't there). `cp` failure is fatal (set -e).
if [ "$MODE" = "bundle" ]; then
  note "staging dist -> assets/public (clean swap) ..."
  rm -rf "$PUBLIC" "$PUBLIC.stage"
  mkdir -p "$PUBLIC.stage"
  cp -R "$REPO/dist/." "$PUBLIC.stage/"
  mv "$PUBLIC.stage" "$PUBLIC"
fi
[ -f "$PUBLIC/index.html" ] || fail "assets/public/index.html missing (in url mode run 'bundle' once first, or npx cap sync, so the packaged fallback exists)"
# Verify the FULL index->asset closure NOW, before gradle: a staged tree that
# passes this packages into a consistent APK (gradle copies assets verbatim).
if [ "$MODE" = "bundle" ]; then assert_closure "$PUBLIC/index.html" "$PUBLIC" "staged"; fi

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

# 4 ── Pre-gradle config verification (the asset closure was already verified at
# stage time in bundle mode; url mode packages web only as an offline fallback).
if [ "$MODE" = "bundle" ]; then
  grep -q '"server"' "$CONFIG" && fail "bundle mode but config has a server block"
  note "verified: config = local bundle (no server block)"
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
# FULL closure inside the APK: extract the packaged index.html + the packaged
# file list, and assert EVERY /assets/* the index references (entry chunk,
# db-*.js code-split chunk, CSS) is actually in the APK — not just the first
# main-*.js. This is the authoritative check that no referenced asset was
# dropped by packaging.
APK_INDEX="$(unzip -p "$APK" assets/public/index.html)"
APK_LIST="$(unzip -l "$APK")"
APK_REFS="$(echo "$APK_INDEX" | grep -oE '(src|href)="[^"]*/assets/[^"]*\.(js|css)"' \
            | sed -E 's/.*"([^"]*)".*/\1/' | sed -E 's#^.*/assets/#assets/#' | sort -u)"
[ -n "$APK_REFS" ] || fail "APK index.html references no /assets/*.js|css — stale index packaged"
echo "$APK_REFS" | grep -q 'assets/main-.*\.js' || fail "APK index.html has no main-*.js entry chunk — stale index"
APK_MISSING=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  echo "$APK_LIST" | grep -q "assets/public/$ref" || { echo "   NOT PACKAGED: $ref" >&2; APK_MISSING=1; }
done <<< "$APK_REFS"
[ "$APK_MISSING" -eq 0 ] || fail "APK index.html references asset(s) NOT packaged (above) — inconsistent APK; re-run this script (clean-stage) before installing"
note "APK verified: $(echo "$APK_REFS" | wc -l | tr -d ' ') referenced asset(s) all packaged, config = $MODE"
echo
echo "✅ $APK"
echo "   install:  adb install -r \"$APK\"   (or send the file to the phone)"
[ "$MODE" = "bundle" ] || echo "   loads:    $URL  (thin shell; TikTok connect blocked by CORS on previews)"
