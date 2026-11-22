# Account limits v2 — Shopee shop = one account, one "Plan full" popup, Channels 2×2

Branch `claude/great-wright-3v8plu`. NOT merged; sql/199, sql/200, sql/201 NOT applied; server not deployed.

## Who sees it

Preview gate (Jeff, 2026-11-22): admins and the login on the `account_limits_v2` feature key
(sql/199 adds one preview login). Everyone else gets today's screens and today's server answers until
`app_settings.shopee_account_enforce` is set to `'true'` (created `'false'` by sql/199).

## Pictures (`shots/`)

Real components (`PlanFullPopup`, `GeneralSettings`, `ShopeeShops`) inside the app's own frame
(`sfl-stage` → `sfl-phone` → `sfl-scroll`), the app's CSS, the preview fake database. All names are made up;
a Shopee shop shows only "Shopee shop ·<last 4>". 360 / 390 / 430 / 1280 px wide (`_390_dark` = dark mode),
deviceScaleFactor 2. iPhone pictures (`_iphone`) are phone widths only.

| File | What it shows |
|---|---|
| `popup-1-basic-one-account_*` | Basic, 1 account, adding a 2nd TikTok name → list + Remove, Upgrade plan |
| `popup-2-confirm-remove_*` | Remove tapped → "Remove @…? Your orders and stickers stay. You can add a new account after 4 hours." [Remove] [Keep it] |
| `popup-3-two-accounts_*` | Plus, 2 accounts, connecting a new Shopee shop |
| `popup-4-wait-countdown_*` | an account was removed: "Wait a little" + live countdown (2h 15m) |
| `popup-5-live-account_*` | Pro, 3 accounts, the TikTok name is live now → "End your live first" instead of Remove |
| `popup-6-not-covered-live-start_*` | Seller A after the copy: the Shopee shop is "Not covered", going live with it |
| `popup-*_iphone_*` | the same on iPhone: "No room for another account", no plan words, **Contact Admin** (a real link) |
| `channels-preview-no-shopee-beta_*` | Settings → Channels, 4 boxes: TikTok, Facebook / Instagram (Coming soon), Shopee (Coming soon — no beta) |
| `channels-shopee-beta_*` | a Shopee beta seller with one shop registered (green dot = registered) |
| `channels-admin_*` | admin: Instagram open, a long TikTok name cut with … |
| `channels-today-everyone-else_*` | today's Channels card — what every non-preview seller keeps seeing |
| `shops-1-list_*` … `shops-5-empty_*` | Shopee shops screen: list + "Accounts used", confirm, live shop, countdown, no shop yet |

Every picture is checked by `harness/shoot.cjs`: no sideways scroll, nothing cut at the sides, the sheet on
screen, every button ≥ 44 px, the right state, Upgrade plan vs Contact Admin (a link), no plan words on iPhone,
Channels 2 boxes per row with one line per account. Result: 87 pictures, all ok.

Re-run: `npx vite --config vite.preview.config.ts --port 5199` then `node docs/design/account-limits-v2/harness/shoot.cjs`.
(`src/dev/fakeSupabase.ts` answers `account_quota` only when the page has `?quota=used,limit,locked`.)

## Proof

- `proof/sql199-behaviour.txt` — `scripts/sql199-behaviour.mjs` (PGlite): the 22 functions it touches start
  from the LIVE text (md5), non-preview sellers get exactly today's answers (62/62 identical), the new rules,
  sql/200, the guard, the rollback.
- Server: `shopeeAccount.server.test.ts` runs the reader against a frozen copy of main's
  (`fixtures/shopeeLiveLink.main199.js`): with no gate or an "off" answer, same requests, answers and logs.
- App: `planFull.app.test.tsx` (real RedesignApp — a non-preview seller sees today's Settings and never reads
  `my_account_list`; the preview login and an admin get the new ones), `PlanFullPopup.test.tsx`,
  `ChannelsGrid.test.tsx`, `ShopeeShops.test.tsx`, `planFull.test.ts`, `shopeeLinkLimits.test.ts`.
