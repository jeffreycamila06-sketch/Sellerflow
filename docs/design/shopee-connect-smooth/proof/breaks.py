# On-purpose breaks: each one changes ONE thing in the app code, runs the tests that should catch it,
# and expects them to FAIL. The files are put back after each run (git checkout).
#   python3 docs/design/shopee-connect-smooth/proof/breaks.py
import subprocess, sys
BREAKS = [
  ("keep-awake ignores Shopee", "src/redesign/adapters/useWakeLock.ts",
   " || s.shEff === true || s.shConnecting === true;", ";", ["src/redesign/adapters/__tests__/useWakeLock.shopee.test.ts"]),
  ("app passes no Shopee to keep-awake", "src/redesign/RedesignApp.tsx",
   "    shEff: shopeeEff, shConnecting: shopeeBusy, // a Shopee-only live keeps the screen on too\n", "", ["src/redesign/adapters/__tests__/useWakeLock.shopee.test.ts"]),
  ("no tap guard (same-moment double tap)", "src/redesign/RedesignApp.tsx",
   "    if (shopeeLinkTapRef.current || shopeeLinkRequestRef.current) return;\n", "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("busy only from the request (main's timing)", "src/redesign/RedesignApp.tsx",
   "  const shopeeBusy = shopeeConnecting || shopeeLinkChecking;", "  const shopeeBusy = shopeeConnecting;", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("no request guard", "src/redesign/RedesignApp.tsx",
   "    if (shopeeLinkRequestRef.current) return; // a request is already under way — never a second one\n", "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("✓ Connected never shown", "src/redesign/components/ShopeeLinkForm.tsx",
   "  const showsConnected = !connecting && connected &&", "  const showsConnected = false && !connecting && connected &&", ["src/redesign/components/__tests__/ShopeeLinkForm.states.test.tsx", "src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("✓ Connected still tappable", "src/redesign/components/ShopeeLinkForm.tsx",
   'data-state="connected" type="button" disabled className', 'data-state="connected" type="button" onClick={go} className', ["src/redesign/components/__tests__/ShopeeLinkForm.states.test.tsx"]),
  ("no Shopee socket-loss grace", "src/redesign/adapters/useLiveFeed.ts",
   "      if (shopeeUpRef.current) scheduleShopeeGray(SOCKET_GRACE_MS);\n", "", ["src/redesign/adapters/__tests__/useLiveFeed.shopeeGrace.test.tsx"]),
  ("Shopee grace pushed later on every drop", "src/redesign/adapters/useLiveFeed.ts",
   "      if (shopeeGrayTimerRef.current) return; // keep the EARLIEST deadline\n", "      if (shopeeGrayTimerRef.current) clearTimeout(shopeeGrayTimerRef.current);\n", ["src/redesign/adapters/__tests__/useLiveFeed.shopeeGrace.test.tsx"]),
  ("TikTok grace changed (must break the main comparison)", "src/redesign/adapters/useLiveFeed.ts",
   "        if (serverConnectedRef.current[p]) scheduleGray(p, SOCKET_GRACE_MS);\n", "        if (serverConnectedRef.current[p]) scheduleGray(p, SOCKET_GRACE_MS * 2);\n", ["src/redesign/adapters/__tests__/useLiveFeed.mainParity.test.tsx"]),
  ("stop reason not kept", "src/redesign/adapters/useLiveFeed.ts",
   "          if (p.reason) setShopeeLastStop({ reason: String(p.reason), at: Date.now() });\n", "", ["src/redesign/adapters/__tests__/useLiveFeed.shopeeGrace.test.tsx", "src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("own restart shows 'another device'", "src/redesign/adapters/shopeeLinkStatus.ts",
   '  if (stop.reason === "restart" && isOwnRestart(stop.at, own)) return null;\n', "", ["src/redesign/adapters/__tests__/shopeeLinkStatus.test.ts", "src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("stop line not cleared at green", "src/redesign/RedesignApp.tsx",
   "    if (shopeeEff) setShopeeNotice(null);\n", "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("link not saved after a good connect", "src/redesign/RedesignApp.tsx",
   "      shopeeLast.save(shareLink);\n", "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("session_end does not clear the link", "src/redesign/RedesignApp.tsx",
   '    if (liveFeed.shopeeLastStop?.reason === "session_end") { shopeeLast.clear(); setShopeeBoxLink(""); } // the live ended: forget its link\n', "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("'ended' answer does not clear the link", "src/redesign/RedesignApp.tsx",
   '        if (code === "ended") { shopeeLast.clear(); setShopeeBoxLink(""); } // that live is over: the box starts empty\n', "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("sign-out keeps the link", "src/redesign/RedesignApp.tsx",
   "    shopeeLast.clear(); // signing out forgets this seller's last Shopee link on this device\n", "", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("one key for every seller", "src/redesign/adapters/shopeeLastLink.ts",
   "export const lastLinkKey = (uid: string): string => `${SHOPEE_LAST_LINK_PREFIX}${uid}`;", "export const lastLinkKey = (_uid: string): string => `${SHOPEE_LAST_LINK_PREFIX}all`;", ["src/redesign/adapters/__tests__/shopeeLastLink.test.tsx", "src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
  ("storage error not caught", "src/redesign/adapters/shopeeLastLink.ts",
   "  } catch { return \"\"; }\n}", "  } finally { /* none */ }\n}", ["src/redesign/adapters/__tests__/shopeeLastLink.test.tsx"]),
  ("'Last link used' note never shown", "src/redesign/components/ShopeeLinkForm.tsx",
   "  const showsLastNote = !!savedLink.trim() &&", "  const showsLastNote = false && !!savedLink.trim() &&", ["src/redesign/__tests__/shopeeConnect.app.test.tsx"]),
]
caught = 0
for name, path, old, new, tests in BREAKS:
    src = open(path).read()
    if src.count(old) != 1:
        print(f"SETUP FAIL  {name}: text not found once in {path}"); sys.exit(2)
    open(path, "w").write(src.replace(old, new))
    try:
        r = subprocess.run(["npx", "vitest", "run", *tests], capture_output=True, text=True)
        failed = r.returncode != 0
    finally:
        subprocess.run(["git", "checkout", "--", path])
    caught += failed
    print(("CAUGHT " if failed else "MISSED ") + name)
print(f"\n{caught}/{len(BREAKS)} breaks caught")
sys.exit(0 if caught == len(BREAKS) else 1)
