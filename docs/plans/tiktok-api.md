# TikTok API — build plan v2 (APPROVED by Jeff 2026-11-02; independent audit applied)

STICK TO THIS PLAN. Do not add, drop or redesign anything. If something in TikTok's real docs contradicts
this plan, or a step is blocked, STOP that step and report it — do not improvise.
Items marked (verify) must be checked against TikTok's official docs before coding them; report what the
docs say.

## Goal
Features that work on TikTok WITHOUT going live, via TikTok's official APIs, so sellers whose LIVE is
suspended keep selling. All OFF for sellers until TikTok approves the apps. Before approval only Jeff's own
TikTok account + the review test account are used (this is also what the demo video records — on
production, behind admin-only switches; preview URLs cannot do OAuth).

## Hard rules (every branch)
- ZERO change to live paths: live comment relay, live_session_orders, buyer numbering, existing
  "TikTok Connect" (live) flow.
- Facebook Post Sales stays byte-identical. Must-pass unchanged: src/redesign/adapters/__tests__/
  fbPostSales.test.tsx, fbPostSales.server.test.ts and all FB goldens. postSalesGate unchanged.
- Migrations: next numbers after 137 (sql/137 IS applied in Supabase as 137a+137b). Each file: matching
  _rollback.sql, "NOT APPLIED" header, begin; set local lock_timeout (pattern sql/126). chat-Claude applies.
- my_feature_access(): redefine by copying the latest key list exactly and appending the new key; rollback
  restores the previous version. One new preview key per branch.
- Switches: app_settings key per feature (read fail-closed, exact 'true') + feature_access_emails preview
  key; add to featureSwitches.ts (SWITCHES_OFF) and featureAccess.ts. Server kill switch
  TIKTOK_API_ENABLED (env) — routes return 404 "off" when off; frontend handles 404 gracefully.
- Tokens: encrypted at rest; key env TIKTOK_TOKEN_KEY (wrap fbTokens.js helpers, don't reuse FB key);
  never sent to the client; logs masked (maskSecretText). Log prefixes [TT-AUTH] [TT-POST] [TT-HOOK].
- Token table RLS like sql/87_account_instagram.sql: RLS select-own, revoke all, column-level
  grant select on non-secret columns only, FK auth.users on delete cascade. No plain views.
- Server wiring in server.js separate from FB init, inside try/catch (can never block FB/live startup),
  OFF unless TIKTOK_API_ENABLED and all env present, fail closed if tables are missing. Seller routes:
  requireAuth + plan check + makeRateGate.
- Render restarts every 3 h: anything that must not repeat (replies, hides, DMs) is recorded in the DB
  (unique per comment/action), never only in memory.
- OAuth from the phone app uses the system browser + auto-return pattern (FB "Authorize auto-return").
- Account limit: a connected TikTok business account's @username must be one of the seller's registered
  TikTok usernames (same seat, server/accountCap.js account_seats) — otherwise refuse with a clear
  message. Never a second seat.
- i18n: all new text in en/fil/zh/zh-TW/vi/th/id/bg. Guide text user-level only (applied when opened).
- Privacy pages (public/privacy, public/delete-account, public/terms) + privacyPolicy.test.ts updated in
  branch 1 with user-level words about TikTok data and disconnect/deletion.
- Constants for TikTok rate limits in one place (server/tiktokConfig.js, mirrors fbConfig.js) (verify
  values).

## Env names (Jeff sets values on Render; never in code or chat)
TIKTOK_API_ENABLED, TIKTOK_TOKEN_KEY,
TIKTOK_BIZ_APP_ID, TIKTOK_BIZ_APP_SECRET, TIKTOK_BIZ_REDIRECT_URI   (TikTok API for Business app)
TIKTOK_DEV_CLIENT_KEY, TIKTOK_DEV_CLIENT_SECRET, TIKTOK_DEV_REDIRECT_URI (TikTok for Developers app)
(Webhook signing: (verify) — developer-portal webhooks sign with the client secret via TikTok-Signature
 t=…,s=…; add a separate secret only if the docs require one.)

## Deploy order (each branch)
1 chat-Claude applies migration → 2 Jeff sets Render env → 3 Jeff manual Render deploy (after live-seller
check) → 4 webhook URL live before it is saved in the TikTok portal → 5 frontend merge (Vercel).

## Branches (separate, in this order; each its own review)

### Branch 1 — claude/tiktok-connect: connection + Settings card + webhook skeleton
- sql/138_tiktok_business.sql: tiktok_business_accounts (user_id FK, tt_account_id text (no FB length
  limits), username, display_name, avatar_url, followers, access_token_enc, refresh_token_enc, scopes
  text[], expires_at, refresh_expires_at, status 'active'|'revoked'|'error', last_poll_at,
  last_webhook_at, created_at, updated_at; unique(user_id, tt_account_id)).
- server/tiktokConfig.js, server/tiktokBiz.js: OAuth start (signed short-lived state bound to user),
  callback (exchange, encrypt, store, enforce same-seat rule), refresh-on-use + daily sweep, store rotated
  refresh token every time, per-account lock on refresh (verify lifetimes ~24 h access / ~1 y refresh),
  account info + stats, disconnect (revoke at TikTok, delete tokens, end that account's selling sales),
  auth failure → status 'revoked' + pause sales + "Reconnect" in UI. Account deletion revokes before
  cascade. Deauthorization webhook if TikTok offers one (verify).
- /tiktok/webhook: add to the express.json() skip list (server.js ~148), express.raw on the route,
  verify signature on raw bytes, timestamp tolerance, rate gate, URL-verification ping (verify),
  respond 200 fast, idempotent. Polling must work alone if no webhook exists.
- Business accounts only (verify): personal/creator → clear "Switch to a Business account in the TikTok
  app" state.
- UI: Settings card named "TikTok videos — sell from comments" (NOT "TikTok Business"; the live
  "TikTok Connect" stays as is): Connect / @username + followers / Reconnect / Disconnect.
- Preview key "tiktok_api"; switch tiktok_api_enabled. Insert preview key for Jeff's email and
  test@gmail.com (review test account).
- Admin health line per account: last poll, last webhook, token expiry.

### Branch 2 — claude/tiktok-post-sales: comments → orders
- sql/139_tiktok_post_sales.sql: fb_post_sales add platform text not null default 'facebook'
  check in ('facebook','tiktok') + tiktok_account_id bigint FK (null for FB); for TikTok rows page_id
  holds the short marker 'tt' (never a long id in FB-sized columns). TikTok comment ids stored as
  'tt:<id>' in fb_post_orders.comment_id (keeps unique(comment_id) safe). New RPC
  tiktok_post_sale_create (SECURITY DEFINER, TikTok switch + key, ownership check via
  tiktok_business_accounts). fb_post_sale_create unchanged. Item codes and the 20-selling-sales limit are
  SHARED across platforms (documented; FB sale may get code_in_use if TikTok uses the code).
  Rollback deletes TikTok rows (orders, items, sales) BEFORE dropping columns.
- FB poller (server.js ~2494 listActiveSales): add .eq("platform","facebook"); test proves it ignores
  TikTok rows.
- server/tiktokPostSales.js: imports the PURE helpers from fbPostSales.js (no copies); poll every 60 s
  with cursor + webhook when available; skip the seller's own comments via the API owner flag (verify);
  marks its own expired sales ended; backoff per sale; reuses fb_post_order_claim.
- Sold out on TikTok = no waitlist in this branch (sold-out reply comes in branch 3).
- Client fbPostSales.ts/usePostSales: filter by platform; mapSale gains platform; postBuyerForPrint for
  TikTok = platform "TikTok" + handle @username (FB rule unchanged). New tiktokPostsGate; Posts tab shows
  when postSalesGate || tiktokPostsGate. Add a TikTok source to SellOnPost/usePostSales without changing
  FB props.
- Video list: (verify) whether private videos are listed.
- Preview key "tiktok_post_sales"; switch tiktok_post_sales_enabled.

### Branch 3 — claude/tiktok-reply-insights: auto-reply + privacy hide + Insights (+ mentions)
- Per-seller settings (Settings → TikTok videos): Reply "Order received" (template), Reply "Sold out",
  Hide comments with phone / store code / address. All default OFF; low reply ceiling (far below API
  limit), 1 reply per comment; plain-words warning that many identical replies can look like spam.
- tiktok_comment_actions(comment_id, action, …) unique(comment_id, action).
- Pure detector, unit-tested on real Taiwanese/Filipino comment samples (TW mobile 09…, +886/+63, 7-11
  6-digit next to store words, FamilyMart format (verify), address keywords). Hide only, never auto-delete;
  Hidden list with reason chip + Unhide. Like = optional "like order comments"; Delete = manual button on a
  flagged comment with confirm.
- Insights screen: followers trend, per video views/likes/comments + SFL orders/sales, "Best 3 times to
  post" list (no 7×24 heatmap), mentions list. "Updated daily". tiktok_insights_daily cache, 90-day
  retention cron.
- Preview key "tiktok_extras"; switches tiktok_auto_reply_enabled, tiktok_insights_enabled.

### Branch 4 — claude/tiktok-dm: Business Messaging (verify access, regions, reply window, caps)
- Buyer messages first → if that buyer has orders, auto-reply with order summary (template, on/off).
- Pickup reminder button on Pickup Status for buyers with an open conversation; never cold DMs.
- If TikTok doesn't support the seller's region: feature hidden with a plain note. Default OFF.
- Preview key "tiktok_dm"; switch tiktok_dm_enabled.

### Branch 5 — claude/tiktok-posting: Content Posting + Login Kit (username) + Embed
- Content Posting with TikTok's required audit UX: creator_info query, privacy selector with NO default,
  interaction toggles, commercial-content disclosure, TikTok consent line; "Private until TikTok approves"
  note; FILE_UPLOAD (PULL_FROM_URL only with a verified domain) (verify caps).
- Login Kit limited to "Add / verify TikTok username" in Manage accounts (needs user.info.profile —
  verify); join by username (open_id differs per app). NO "Sign in with TikTok" to SFL in this plan.
- Embed: seller's chosen video on the future receipt page (embed only).
- Preview key "tiktok_posting"; switch tiktok_posting_enabled.

### Branches 6a/6b/6c — TikTok Shop (PH/TH first), audited addendum
Why: in PH/TH sales go through TikTok Shop checkout (sanctioned by TikTok). SFL = the seller's
order / print / ship back office. Not in Taiwan.
BEFORE building 6a, confirm in Partner Center docs and report (verify): region choice permanence and
whether one Global app serves PH + TH; public vs custom app (and listing/review needs); accepted business
documents (PH sole-prop); sandbox/test shop; request signing (HMAC over path+params+body, shop_cipher);
webhook signing; token lifetimes; rate limits; label/fulfillment rules. Scopes requested must match screens
actually built.
Common rules: market.ts gets a `tiktokShop` flag per Market (true PH, TH; false TW, BG; SG needs a market
entry first) AND gate on the shop's own region from the shop-info API. Env TTSHOP_ENABLED, TTSHOP_APP_KEY,
TTSHOP_APP_SECRET, TTSHOP_REDIRECT_URI (+ webhook secret only if docs require). Webhook route on the
raw-body skip list. Own try/catch wiring, fail closed; switch tiktok_shop_enabled + preview key
"tiktok_shop"; SWITCHES_OFF + featureAccess. Migrations: next free numbers at branch time, rollback files,
RLS select-own, column grants (tokens never readable), FK cascade, 3-month retention cron. Minimum buyer
data (name/@handle, items, status, tracking; no full address/phone stored unless the label flow truly needs
it, then masked) — follow TikTok Shop data rules (verify). Privacy pages updated; revoke on disconnect and
account deletion. Nothing touches live, FB or Post Sales paths.
Account seat for a connected TikTok Shop: JEFF DECIDES (ask; do not decide in code).
- 6a claude/tiktok-shop-orders: authorization + shop info, orders mirror (webhook + poll), sticker print.
  TikTok Shop order ids are long strings: NEVER put them in orderNum/bNum (JS precision) — orderNum = SFL
  row id or created_at ms; separate display field "Order #"; printed flag mapped by row id (like
  markPostOrdersPrinted). Sticker shows "Order #…" with printBuyerNumber:false, correct on BOTH sticker
  layouts (v1 + v2), never the v2 "Buyer 88" slot. Thai text: AIMO prints ASCII/Simplified Chinese only →
  TH stickers use the raster path or a transliteration fallback; test every printer before TH opens.
- 6b claude/tiktok-shop-fulfillment: shipping label + fulfillment actions (writes to TikTok): label is a
  PDF (A6/100×150, verify) → open/share PDF or print on a label-size printer — NOT the 40–60 mm sticker
  route. Every write: seller confirms, idempotency key, logged result. Handle fulfillment types where
  labels/addresses aren't available (verify); label URLs may expire (verify).
- 6c claude/tiktok-shop-lists: packing list (product × qty per day), returns (read-only), finance daily
  totals (read-only). Today's totals at the top of the Shop tab (not in Insights).
UI 390 px: Orders tab label "Shop" (short for fil/th/vi); status chips To ship / Shipped / Delivered /
Return in one horizontally scrolling row; each card: Print as main button, Label + Tracking in a "⋯" sheet;
"Print all new (N)" in a sticky bottom bar.
Out of scope v1: product create/edit, price/stock sync, promotions, affiliate, buyer chat (later 6d).

## Demo script (deliver docs/plans/tiktok-demo-script.md in branch 1, extended each branch)
Table: scope → seller story (why) → screen → action → expected result. Recorded on production as admin.
Starts with the real TikTok consent screen. Fallback: if TikTok rejects a scope, the app works without it.

## UI design brief (390 px, mobile first; previews required before coding each branch's UI)
- Orders → Posts: platform chips only when 2+ platforms are connected.
- TikTok video picker: list rows (thumbnail 9:16 small + caption 2 lines + date + "Selling" badge),
  same look as the FB post list (no 3-column grid).
- Sell sheet: each item = name on its own line, then code / price / stock in one row; numeric keyboards;
  mode toggle (Codes | +1); status chips showing whether auto-reply / hide are ON (settings live in
  Settings).
- Active sale card: thumbnail, "Orders · Sold", End button, last comment time. Never "live" wording.
- Hidden comments drawer: reason chip (Phone / Store code / Address) + Unhide.
- Insights: 3 summary tiles (followers, views 7 days, orders 7 days), "Best 3 times to post", per-video list.
- Settings card "TikTok videos — sell from comments" with one user-level line; Business-account empty state.
- Empty states / errors in seller words, no technical codes. Neutral icons, no TikTok logo misuse.

## Out of scope
TikTok LIVE via official API (doesn't exist). Marketing API (Spark Ads, lead forms) — later.
"Sign in with TikTok" to SFL — later.

## Note for sql/138 and sql/139 (added 2026-11-03 by the buyer-contact branch)
sql/140 (buyer contact) adds the preview key `'buyer_contact'` to `my_feature_access()`. Whichever of
138 / 139 / 140 is applied LAST must rebuild `my_feature_access()` from the LIVE definition
(`pg_get_functiondef`) keeping every key the live function has — `'buyer_contact'` included.

