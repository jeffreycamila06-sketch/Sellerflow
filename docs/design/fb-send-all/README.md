# FB-2 — Invoicing → Facebook "Send all in Messenger"

Real app, preview mode, made-up seller and buyers (`?ivc=6,2&fbsa=1&admin=1`). The script plays the server's
answers; the ✎ View picture is drawn by the server's own code (`server/receiptDraw.js` + the Send all words),
the same function the job sends. Re-run: `npx vite --config vite.preview.config.ts --port 5199`, then
`node docs/design/fb-send-all/shoot.cjs 5199`.

- `shots/fb_tab_*` — the tab (iPhone 390 / Android 360 / laptop 1280, light + dark)
- `shots/fb_running_iphone390_light.png` — while a job runs
- `shots/fb_view_*` — ✎ View with the picture, Send to #N / I sent it by hand / Buyer cancelled
- `shots/fb_how_iphone390_light.png` — the "How" steps for "Other chat app"
- `shots/lang_360_*` — every language at 360 px
- `measured.txt` — 360 / 390 / 430 / 1280 × 8 languages: no sideways scroll, nothing outside the screen,
  the big button 52 px and not cut, every chip / How ≥ 44 px, row View / Send = 44 px tap areas.

## Order (Render deploys from main)

1. Apply `sql/225` (jobs table + switch row, off). It must be in before the merge: the nightly Render deploy may start the server half that night.
2. Merge (Vercel). Until the Render deploy, admins see "Couldn't load" on the Facebook tab; everyone else sees today's tab.
3. Render deploy in a quiet window (by hand, or the nightly one).
4. Test as admin on a real live.
5. Flip the switch `fb_send_all_enabled`.
6. Apply `sql/226` (help guide).

## Several sellers at once

Jobs of different sellers run at the same time; each seller's own jobs run one after another, so the 10-a-minute limit holds per seller. A job waiting behind the same seller's other job keeps a heartbeat (at least every 30 s), so the database never takes it back as stale. Proof: `src/redesign/adapters/__tests__/fbSendAll.lanes.server.test.ts` — all 4 tests fail on the old one-after-another pass.
