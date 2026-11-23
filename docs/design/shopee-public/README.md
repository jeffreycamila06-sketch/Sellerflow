# Shopee Live for every seller (branch `claude/shopee-public`, sql/206 + sql/207)

Jeff's decisions (2026-11-23): every plan can use Shopee Live, the Free plan too, under the same plan rule as a
TikTok connect; a Shopee shop counts in the same account total; a seller who still has days from Admin (an
active `shopee_beta` row) keeps what they have until that date, then follows the plan like everyone else; the
Admin screen's "Shopee Beta" row is removed now.

**Switch:** `app_settings.shopee_public_enabled` (sql/206 creates it `'false'`). Off = today. On = the above.
An admin always sees "on". One test login can see it before the switch through the preview key
`shopee_public` (`feature_access_emails` — no login is added by this branch).

## What is in this folder

| | |
|---|---|
| `shots/` | Pictures of the REAL app in preview mode (made-up names): the Live screen's Shopee tile, the paste box, Settings → Channels, the Shopee shops screen. 360 / 390 / 430 / 1280 px, dark, and 8 languages at 360 px. |
| `shots/measure.txt` | Per picture: sideways scroll (none), the height of the Shopee tile, the link field, the Connect button and the Channels box, and the line each one shows. |
| `harness/shoot.cjs` | The script that took them. |
| `proof/on-purpose-breaks.py` | Deliberate breaks of the server gate, the app rule, the SQL file and the guide — each must turn a test red. |
| `proof/on-purpose-breaks.txt` | Its output. |
| `proof/sql206-behaviour.txt` | The database proof (real Postgres in WASM): `scripts/sql206-behaviour.mjs`. |

Picture names: `off_…` = switch off (today), `on_…` = switch on.

| picture | what it shows |
|---|---|
| `off_tile_no_row` | today: a seller without Shopee from Admin — "Coming soon" |
| `off_tile_ended_row` | today: the days from Admin are over — "Shopee access ended — contact Admin" |
| `off_channels` | today: Settings → Channels, Shopee box "Coming soon" |
| `on_tile`, `on_tile_free_plan` | the Shopee tile can be tapped (paid plan, Free plan) |
| `on_box` | the paste box |
| `on_tile_ended_row` | days from Admin over: no lock any more |
| `on_tile_active_row_free_plan` | days from Admin still running on a Free plan: as today (days line; TikTok / Facebook locked) |
| `on_box_plan_ended` | paid plan ended: "Your plan has ended. Renew to connect again." (the TikTok text) |
| `on_box_plan_ended_iphone` | the same on the iPhone app: the neutral "contact support" pop-up, no line in the box |
| `on_tile_other_market` | a market outside Taiwan / the Philippines: "Coming soon" (unchanged) |
| `on_channels`, `on_channels_shop` | Settings → Channels: the Shopee box open ("Not connected" / the shop) |
| `on_shops_empty`, `on_shops_one` | the Shopee shops screen |

## How "off = today" is proven

- **Server** — `shopeePublic.server.test.ts` part A: a frozen copy of main's reader
  (`fixtures/shopeeLiveLink.main206.js`, main 8a237c68) and the branch reader are given the same 10 situations,
  for a beta seller and for a seller without a beta row, in each of the 8 ways "Shopee is not open" can reach
  the reader (no access step, the database says false, null, the function is missing, a database error, a
  thrown call, a word instead of true, the access step itself throws) — 160 cases: same answer, same requests
  to Shopee, same statuses, same log lines, same readers started.
- **App** — `shopeePublic.test.ts` "OFF = MAIN": what the seller sees (Shopee box yes / no, locks, days line)
  is compared with main's own three lines for every combination of admin × beta row (none / active / ended) ×
  paid plan × market (24 cases). `shopeePublic.app.test.tsx` shows the same on the real app.
- **Database** — `scripts/sql206-behaviour.mjs`: after applying sql/206 every other function keeps its text,
  the 27 older feature keys answer the same for every login, the switch is `'false'`, nobody is on the list.
