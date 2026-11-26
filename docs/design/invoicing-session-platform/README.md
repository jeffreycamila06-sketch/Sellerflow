# Invoicing — session picker per platform (2026-11-27)

Live data (2026-11-27): every session belongs to ONE platform (switching platform starts a new session).
Before this change every Invoicing tab showed the same session list (the Orders tab's list).

## What changed (web only — Vercel)
- Each tab lists only its own platform's sessions: TikTok tab → TikTok sessions, Facebook tab → Facebook
  sessions. Instagram / Shopee stay "Soon".
- The list is the Orders tab's list (`my_session_summaries`, `adapters/pastSessions.ts usePastSessions`),
  asked with a platform. Each session's platform comes from ONE stored order row of that session (one tiny
  `limit 1` read per session, at most ~12 per seller, remembered for the app's life). The Orders tab calls the
  same hook without a platform → exactly the list it had before, no extra read.
- "This session" is on the tab of the platform the session belongs to (its orders; with no order yet, the one
  platform live now). With no orders and not live it is on every tab, each saying
  "No <platform> buyers in this session yet." The "This session can't be sent from here" note on the Facebook
  tab stays only for a real old session (Facebook buyers, no session id).
- A tab whose platform is not the running session's opens on its newest session of that platform; with none:
  "No Facebook sessions yet." / "No TikTok sessions yet." (8 languages).
- Each tab keeps its own pick (picking a Facebook session does not move the TikTok tab).

## Pictures (`shots/`, real app in preview mode: `?ivc=6,2&fbsa=1&ivcplat=1&admin=1`)
- `tiktok_<device>_<theme>.png` — TikTok tab, list open: This session + the 3 TikTok sessions.
- `facebook_<device>_<theme>.png` — Facebook tab: opens on the newest Facebook session (amber).
- `facebook_menu_<device>_<theme>.png` — its list: the 2 Facebook sessions, no "This session".
- Devices: iPhone 390 (light + dark), Android 360, laptop 1280. `measured.txt`: no page wider than the screen,
  every list row ≥ 44 px.

Run: `npx vite --config vite.preview.config.ts --port 5199` then `node docs/design/invoicing-session-platform/shoot.cjs`.
