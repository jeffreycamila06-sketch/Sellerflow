# Admin → Live Pulse monitor tile + Live Pulse in the phone apps (2026-11-27)

Branch `claude/pulse-tile`. Admin only. Web only (Vercel) — no SQL, no Render, no app build.

- **Live Pulse in the apps:** the tile, the panel and the panel's activity read were web-only
  (`!isAppShell()` in Admin.tsx ×2 and RedesignApp's `useBusinessPulse`). All three gates removed.
  The panel shows counts only (orders, sellers, hours, the TikTok limit card) — no price or revenue
  anywhere, checked in the tests (web / Android / iPhone) and on the real iPhone-app preview.
- **Tile (`components/AdminPulseTile.tsx`):** FIRST in Controls, the same grid cell as the others
  (same row height measured: 102 px). Pill with a pulsing dot + the number live now, label
  "Live Pulse", line "N / LIMIT live". Tap = the Live Pulse panel.
- **Number + limit:** `usage.concurrent` / `usage.concurrentLimit` of `/admin/tiktok-cooldown/status`
  (`loadTikTokCooldownStatus`) = the TikTok connection limit card's "live now X/Y". Never written in
  the app. No usable answer (refused, 403, no usage, limit 0, offline) → grey "—".
- **Colour (`adapters/livePulseCount.ts` `liveLevel`):** green < 60 %, amber ≥ 60 %, red ≥ 70 % (the
  card's own warn share) — pill + tile border. Whole-number compare, no rounding drift.
- **Refresh (`useLiveCount`):** one read when the Admin screen shows, then every 60 s while the page is
  in front; nothing while hidden; back in front after 60 s → one read at once; nothing after the screen
  is left. The Admin screen only exists for admins → a seller never reads it.
- **Motion:** `.sfl-lpt-dot` — off with `[data-motion="off"]` and prefers-reduced-motion.
- **Texts:** `rd_pulse_tile_line`, `rd_pulse_tile_unknown`, `rd_pulse_tile_aria` — English in all 8 languages.

Proof: `screens/__tests__/Admin.pulse.test.tsx` (14), `adapters/__tests__/livePulseCount.test.tsx` (11),
`__tests__/pulseTile.app.test.tsx` (6, real RedesignApp, admin vs seller × web / Android / iPhone);
9 of 9 on-purpose breaks caught. Pictures: `shots/` (admin screen iPhone 390 / Android 360 / laptop 1280
light + dark, the four colours, the panel in the iPhone app) · `measured.txt` (360 / 390 / 430 / 1280).
Preview: `?admin=1&pulse=1` (+ `&apk=1&ios=1` for the iPhone app); the live count needs a stand-in route
(the shoot script answers it).
