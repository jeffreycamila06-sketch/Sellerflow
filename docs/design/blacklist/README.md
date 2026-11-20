# Blacklist — STEP 0 (study + pictures, nothing built)

Branch `claude/blacklist` (from main `671663a8`), 2026-11-20. No app code, no SQL, nothing applied or deployed.
Only this folder.

## Pictures

- `sheet_iphone390_{en,fil}.png`, `sheet_android360_{en,fil}.png`, `sheet_laptop1280_{en,fil}.png` — overview.
  Row 1: Settings tile · reason not picked yet · Return picked · reading the QR · added + Undo · already added today.
  Row 2: QR with no buyer · search · Remove question · empty list · live rows with the chip · the dates sheet.
- `shots/<view>_<state>_<device>_<lang>.png` — all 72, full page (iPhone 390, Android 360, laptop 1280; English, Filipino).
- `measured.txt` — every picture: 0 px sideways scroll, no cut text, every phone button ≥ 44 px tall.
- How they were made: `harness/` (`npx vite --config docs/design/blacklist/harness/vite.config.mjs --port 5333`,
  then `node docs/design/blacklist/harness/shoot.cjs`, `python3 -I docs/design/blacklist/harness/sheet.py`).
  Settings and Live are the REAL screens (SettingsHub, Dashboard) on made-up data; the tile, the chip and the
  dates sheet are drawn into them by the picture page only. The Blacklist screen is a proposal in the app's own
  colours, header and Back button.
- ⚠️ The owner's approved canvas (chat-Claude) is not in this repository. These pictures follow the written
  description; differences from the canvas can be fixed before the build.

## How the sticker QR is read today

| | |
|---|---|
| What is printed | `https://tiktok.com/@<username>` (since Sep 21 2026). Only when the seller turned **Print QR on sticker** on (per phone, off by default), only for **TikTok** buyers (Facebook / Instagram / Shopee orders get no QR), only on stickers taller than 40 mm (50×30 and up on the new sticker). Available in every country and on every plan. |
| Old stickers | A plain `@username` QR existed for a few hours on Sep 21 2026 only. |
| QR off / Facebook buyer | No QR on the sticker → the seller types the @username or the Facebook name. |
| The reader | `src/redesign/adapters/qrDecode.ts` (phone camera photo or a picture file; BarcodeDetector, else jsQR) → `src/lib/tiktokHandle.ts` `handleFromQrPayload`. Used today by Parcel Scan (Taiwan). |
| Phone | The Scan button opens the phone's own camera / photo choice (no live viewfinder). Camera permission is already in both apps. |
| Laptop | No camera needed: the same button picks a photo file ("Upload sticker photo"); typing is the main way. |
| A non-SFL QR | `handleFromQrPayload` today also accepts ANY short plain word (e.g. a QR that says `ABC123`) as a username. **For the blacklist I propose a stricter reader**: only a `tiktok.com/@…` link or a text starting with `@`; anything else → "This QR has no buyer". No QR found in the photo → "No QR found — try again or type the username". Parcel Scan keeps its reader unchanged. |

## Where the chip goes on the live row (no order or print change)

`src/redesign/screens/Dashboard.tsx`, the comment row (`.sfl-comm-row`), the same place the Taiwan Buyer Alert
adds its tint and chip. The new parts only READ a map (one lookup per row) — the 1-Click / Type price buttons,
`createOrder`, printing and buyer numbers are not touched. In the pictures the chip sits on its own line under
the comment, because on a 360 px phone name + @handle + chip + time on one line made the name wrap. Tapping the
name opens a sheet with the dates per reason and "Alert only — the order still prints as usual."

## Data plan (to build after your go)

- **One table** `buyer_blacklist` (own rows only): user_id, platform (`tiktok` / `facebook`), buyer key (TikTok:
  username without `@`, lower case; Facebook: the name, trimmed, lower case — exact match otherwise), the name as
  shown, reason (`not_checked_out` / `returned`), day, time added.
  **Unique (seller, platform, key, reason, day)** → "Already added today" comes from the database.
- RLS: the seller reads, adds and deletes only their own rows. No update. Nothing shared between sellers, no admin
  view (unless you want one).
- **One small database function** to add: works out "today" in the seller's own time zone (sent by the phone,
  checked against the known zone names, else UTC) and answers `added` (with the row id for **Undo**) or
  `already_today`. Undo = delete that row. **Remove** = delete all rows of that buyer (after a yes/no question).
- **Live:** the list is read once when the live starts and again after the seller adds or removes; no timer.
  A buyer added on another phone shows after the next live start.

## Who sees it

- **Market:** a new market flag `blacklist` — on for every market except Taiwan; Taiwan keeps today's Buyer Alert
  and sees no Blacklist tile. Admin sees both (the usual "all markets" view).
- **Plans:** all plans (Free, Basic, Plus, Pro, Master). No plan check.
- **Rollout:** I suggest a kill switch (`app_settings`, off) + a tester list first, then on for everyone.
- **NEW badge:** until the seller opens Blacklist once on that phone (like the Posts red dot).

## Buyer Alert (Taiwan) stays as it is

Buyer Alert's code (`adapters/buyerAlert.ts`, `BuyerAlertSheet.tsx`, sql/72, sql/125) is not changed. The
blacklist only copies its look (red tint + left bar, the red chip colour, the bottom sheet). Today Buyer Alert
shows nothing outside Taiwan: 0 of the 138 sellers outside Taiwan have any pickup rows (live data, 2026-11-20).

## Live numbers (2026-11-20, counts only)

| | Sellers | With a Facebook Page |
|---|---|---|
| Outside Taiwan | 138 (PH 73, MY 9, AU 9, KR 7, BG 5, JP 5, ES 4, US 4, CA 3, CN 3, TG 3, others 13) | 14 |
| Taiwan | 299 | 11 |
