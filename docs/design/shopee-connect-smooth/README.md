# Shopee paste box — smoother connect (2026-11-22, app only)

Branch `claude/great-wright-3v8plu` (from main `360ce26c`). Jeff's approved design:
claude.ai/artifact/159XJFhCaSCQahh7FFFb6y. Web only — **no server change, no Render deploy, no database change**,
Chrome extension 0 lines. Phone apps load the web, so no app build.

## What changes for a Shopee seller
1. **Screen stays on** during a Shopee-only live (keep-awake already did this for TikTok / Facebook / Instagram).
2. **One connect at a time.** From the tap, the box says **Connecting…** and cannot be tapped again — also during
   the session check before the request. While Shopee is green and the box holds the connected link, the button
   reads **✓ Connected** (green outline) and cannot be tapped; another link in the box → **Connect** again.
3. **Status like TikTok / Facebook.** A lost app connection grays the Shopee pill after 8 s unless the server
   confirms the reader still runs. When the server stops the reader it says why, in one orange line on the box:
   live ended · Shopee stopped answering · connected on another device · connection reset · time limit
   (8 languages). This device's own new connect never shows "another device".
4. **Last link remembered** on the phone, for the signed-in seller only: the box opens with it plus
   "Last link used. Paste a new one for a new live.", so one tap reconnects after a restart. Cleared when the live
   ends, when a connect answers "ended", and at log-out.

## Pictures (the real Live screen + the real box, deviceScaleFactor 2)
| File | State |
|---|---|
| `1-connecting_*` | Connecting… (Change link while green) |
| `2-connected_*` | ✓ Connected |
| `3-stopped-ended_*` | stopped: "Your Shopee live has ended." — box empty |
| `3-stopped-other-device_*` | stopped: "Shopee was connected on another device." — link kept |
| `4-last-link_*` | app opened again: last link + note, one tap to reconnect |

Devices `iphone-390x844`, `android-412x915`, `laptop-1280x800`; `_dark` = iPhone in dark theme.
Made by `harness/shoot.cjs` (dev server first: `npx vite --port 5199`); it checks each picture (button text, the
line that must / must not show, no sideways scroll, button ≥ 44 px) — `proof/shoot.txt`.
States 3 and 4 are in the Live picker (Shopee gray → the four tiles, Shopee tile tapped); 1 and 2 are the
"Shopee Live · Change link" button with the box open. In the picker the box hides while connecting and the
Shopee tile itself says Connecting… (the picker does this for every platform).

## Proof
- `proof/breaks.txt` — 20 on-purpose breaks in the app code, every one caught by the tests.
- `useLiveFeed.mainParity.test.tsx` — main's own copy of the live-feed hook (`fixtures/useLiveFeed.main.ts`) and the
  branch hook get the same socket events (TikTok, Facebook and Shopee) on the same fake clock: every TikTok /
  Facebook output and every emit identical, 5 scripts.
- `useWakeLock.shopee.test.ts` — TikTok / Facebook / Instagram keep-awake = main's rule in all 64 combinations.
- `shopeeConnect.app.test.tsx` — the real RedesignApp: double tap = one request (box, length picker), ✓ Connected,
  each stop line, own restart shows nothing, the saved link (save, reopen, ended, session end, log-out, other seller).
