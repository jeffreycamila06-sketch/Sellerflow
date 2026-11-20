# Facebook Post Sales for every paid seller

Branch `claude/fb-post-sales-public`, 2026-11-20. Database (sql/188, sql/189), server (Render) and web (Vercel).
Nothing merged, applied or deployed.

## What changes for a seller

| Seller (with a connected Facebook Page) | Orders screen |
|---|---|
| Plus / Pro / Master, active, not past expiry | **Live \| Posts** — the Posts side as before |
| Admin, or on the `fb_post_sales` tester list | the same, whatever the plan |
| Free, Basic, an expired / pending plan, or past its expiry | **Live \| Posts 🔒** — a tap opens "Feature locked" (Contact Support / Maybe later), the same popup as Pickup Status; nothing about posts loads |
| no Facebook Page, or the switch off | no segment (as before) |

- **End date:** a − / + day picker, 7 days at first, 1 to 14 days, the date shown under "Ends". The database refuses
  more than 14 days.
- **Several "+1" posts can sell at the same time.** A code-mode code is still one open post at a time.
- **Plan ends:** the open posts stay; they take no new orders (no Facebook call at all). Renewed before a post's end
  date → it takes orders again, including the comments written in between.
- **Waitlist Give** gives from the post the buyer commented on (two "+1" posts = two lines, each with its own stock).

## Fix round 1 (2026-11-20)

| | What changes |
|---|---|
| **Lives first** | While the live comment reader runs for a Page, the post reader makes **no** Facebook call for that Page's posts and does not move their place. After the live, the comments written during it are read in the order they were written; each becomes one order. Other Pages are read as usual. |
| **End date / End now** | Judged by when the **comment** was written: written before the end (or before End now) → an order, also when read later; written after → none. A sale past its end date is read once more, then ended. One that still cannot be read 24 h after its end date is ended without reading. |
| **Plan ended, has post orders** | Posts opens **view-only**: the post orders and My posts; no Sell on a post, Print new, Give, Edit or End now (one line says why). The database refuses Print new (mark printed), Edit and End now too. Free / Basic without post orders: **Posts 🔒** as before. |
| **Waiting line** | Waiting post buyers show also while a live session runs. |
| **Help guide** | Posts: not in Sales / exports / Send to TikTok / Products stock; post orders wait while the Page is live; the view-only state. Plans: a Posts column. sql/189 = two rows. |

- Pictures: `sheet_readonly_iphone390_en.png`, `sheet_readonly_android360_en.png` (+ `_zh-TW`) — left to right: the
  waiting line (post buyers' Give off + the line; a live buyer's Give on) · the view-only Posts side · My posts.
  One by one: `shots/readonly_*`, `shots/readonly_waitlist_*`, `shots/readonly_my_*` (iPhone 390 / Android 360 /
  laptop 1280). `proof/pictures-readonly-measured.txt` — 8 languages × 3 devices: right everywhere, 0 px sideways
  scroll, no cut text. Script: `harness/shoot-readonly.cjs` + `harness/sheet-readonly.py`.
- `proof/round1-without-the-code.txt` — the new and changed tests against the branch before this round (e868ffe7).
- `proof/calls-per-hour.txt` — re-measured with a 2-hour live: 0 post calls for the live Page during it.
- `proof/sql188-behaviour.txt` (148 checks) and `proof/sql189-behaviour.txt` (10 checks, `scripts/sql189-behaviour.mjs`).

## Pictures (the real screens, `harness/`)

- `sheet_iphone390_en.png`, `sheet_android360_en.png` (+ `_zh-TW`) — left to right: a Plus seller's Posts side ·
  a Free seller's Orders with **Posts 🔒** · the popup after tapping it · the Ends picker at 7 days · at 14 days (+ off)
- `shots/<view>_<device>_<lang>.png` — one by one, iPhone 390 / Android 360 / laptop 1280, English and Traditional Chinese
- `proof/pictures-measured.txt` — every view × 8 languages × 3 devices (72): 0 px sideways scroll, no cut text, the
  plan answer right in every case, the − / + buttons 44×44

```bash
npx vite --config docs/design/fb-post-sales-public/harness/vite.config.mjs --port 5332
```

```bash
node docs/design/fb-post-sales-public/harness/shoot.cjs
```

## Proof

- `proof/without-the-code.txt` — the new and changed tests against main's source: 36 fail, 52 pass (the 3 older test
  files, plus 11 new checks that something stays as before); the SQL text checks cannot load (sql/188 is not on main).
- `proof/on-purpose-breaks.txt` — 47 one-line breaks (poller, server, app, SQL, help guide): 47 caught. SQL breaks also
  run the PGlite proof. Script: `proof/on-purpose-breaks.py`.
- `proof/sql188-behaviour.txt` — sql/188 on a throw-away Postgres (`scripts/sql188-behaviour.mjs`, PGlite): 98 checks,
  incl. the claim and create functions, the live function texts side by side, the rollback = production (md5).
- `proof/calls-per-hour.txt` — the real post poller, 20 open sales on one Page, one simulated hour
  (`proof/calls-per-hour.mjs`).
