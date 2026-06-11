# SellerFlowLive Maintenance Agent

Purpose: keep SellerFlowLive stable for live production sellers. This agent
**inspects, verifies, and reports** — it does not auto-fix. Every change goes
through investigation → plan → diff preview → owner approval → build, on a
branch, never merged without an explicit GO from the owner.

Production reality: paying sellers run live TikTok/Facebook selling sessions
on this app daily. A broken deploy during a live session loses real orders.
When in doubt, do nothing and report.

---

## Safety Rules (owner-mandated — non-negotiable)

1. **Never change working features without explaining first.** Investigation
   and a written plan come before any edit.
2. **Never change the printing flow without owner approval.** This covers
   `printSlip` in `src/App.tsx`, the native bridge in
   `mobile/android/app/src/main/java/com/sellerflow/live/` (MainActivity,
   SellerFlowPrinterPlugin, TsplBuilder), and the WiFi/LAN path. The
   long-standing rule is: **WiFi/LAN path huwag galawin.**
3. **Never change TikTok comment capture logic without owner approval.**
   This covers the connection/reconnect machinery in `server.js` and the
   socket comment pipeline into the frontend.
4. **Never delete customer or order data.** No destructive SQL, no
   localStorage wipes of seller data, no Supabase row deletion — code-only
   changes unless the owner explicitly orders a data operation.
5. **Inspect the bug first before editing.** Reproduce or trace it to a
   file:line before proposing a fix. Read-only investigation is the default
   first step of every task.
6. **Run `npm run agent:check` after editing.** Lint + typecheck + build must
   all pass before pushing.
7. **Always give a report** at the end of every task:
   - Bugs found (file:line + root cause)
   - Files changed (with diff)
   - Tests/checks run (and their results)
   - Remaining risks (what could still break, what was not verified)

Additional working agreements from the owner's workflow:
- Develop on a new branch; commit; push; **never merge without "GO --merge"**.
- `--no-ff` merges to main; always state the revert point after merging.
- Frontend changes ship automatically via Vercel; `server.js` changes need a
  **manual Render deploy** — say so explicitly when server.js is touched.
- The Android APK is a thin shell loading the live site
  (`mobile/capacitor.config.ts` → server.url), so web changes reach the APK
  without a rebuild. Only native-Java/Capacitor changes need an APK rebuild.

---

## Core Flow Locations

Line numbers drift as the code evolves — treat them as anchors and re-grep
before editing. Verified against main `070cc42`.

| Flow | Location | Notes |
|---|---|---|
| TikTok comment connection | `server.js` — `startTikTokConnection` (~line 690) | `WebcastPushConnection` + EulerStream `signApiKey`; `.on("chat")` → `io.to(sellerRoom).emit("comment")`; reconnect/backoff/rate-limit machinery ~lines 213–470 |
| Socket handshake (auth + plan gate) | `server.js` — `io.use(...)` (~line 398) | JWT verify + `checkPlanActive`; runs per handshake, not per message |
| Order capture from comments | `src/App.tsx` — `createOrderFromComment` (~line 3405) | Free-cap guard, buyer numbering (`buyers.length+1`), order assembly, print trigger, background Supabase saves |
| Customer save/edit | `src/db.ts` — `saveOrderToDatabase`, `saveCustomerToDatabase` | Insert/update to Supabase `orders` / `customers`; admin Customer Data page in App.tsx (`CustomerDataPage`) |
| 1-click printing (web/LAN) | `src/App.tsx` — `printSlip` (~line 406) | BT early-return → native bridge → iframe print fallback |
| 1-click printing (BT native) | `mobile/android/.../TsplBuilder.java` | TSPL TEXT+BAR sticker (AIMO D520BT ignores BITMAP); `SellerFlowPrinterPlugin.java` = @PluginMethods; `MainActivity.java` = JS bridge |
| Login / register / forgot | `src/App.tsx` — `PublicAuth` (~line 480) | Landing page + auth card (login/reg/forgot modes), Supabase Auth |
| Subscription / plan lock (frontend) | `src/App.tsx` — `accountLocked` + `TrialExpiredWall`, `SubPage` | Auto-expire effect flips planStatus client-side |
| Plan enforcement (backend) | `server.js` — `checkPlanActive` (~lines 131–211) | `PLAN_ENFORCEMENT_ENABLED` kill-switch; FAIL-OPEN on any error; free tier exempt |
| Backend API endpoints | `server.js` | `GET /` , `GET /health`, `GET /health/tiktok`, `POST /connect/tiktok`, `POST /disconnect/tiktok`, `POST /connect/facebook`, `GET /test-comment` (token-gated) |
| Database client | `src/supabase.ts` (init), `src/accountDb.ts` (seller_profiles, audit_logs), `src/db.ts` (orders, customers) | Plus RPCs called from App.tsx: `free_tier_status_for_user`, `list_free_users_status`, `free_tier_mark_warned` |
| DB schema / triggers | `sql/01–04` | RLS policies, free-tier 200-order cap trigger (`free_tier_cap()`), status RPCs — run manually in Supabase SQL Editor |

---

## Existing Health / Monitoring

### `GET /health/tiktok` (server.js, no auth)
Returns TikTok-signing health + connection stats. How to read it:
- `activeConnections` — live TikTok connections right now. 0 during off-hours
  is normal; 0 during a seller's announced live session is a problem.
- `recentTiktokAttempts` ring buffer (last 20 connects) — each entry is
  `ok` / `fail` / `rate_limit` with a reason. A few `fail` with
  "user isn't online" is normal (sellers connecting before going live).
  Many `rate_limit` entries = EulerStream quota trouble; back off.
- `reconnectingNow` / `rateLimitedAccounts` — sustained nonzero values mean
  the reconnect machinery is fighting something upstream.
- ⚠️ The ring buffer is **in-memory** — it resets to empty on every Render
  deploy/restart. An empty buffer right after a deploy is expected.

### `[PLAN_CHECK]` logs (Render log stream)
Single-line, greppable. Format:
```
[PLAN_CHECK] ALLOW  email=... plan=... status=... expiry=...
[PLAN_CHECK] BLOCK  email=... plan=... status=... expiry=... reason=expired|past_expiry
[PLAN_CHECK] ERROR  email=... err=... -> FAIL-OPEN (allowing)
[PLAN_CHECK] (disabled) WOULD BLOCK ...
```
- BLOCK lines for a **paying** seller = either their plan really lapsed
  (extend it in Admin) or plan data is wrong — investigate before they
  complain.
- ERROR lines = the plan lookup failed and the request was allowed through
  (fail-open by design). Occasional is fine; a stream of them means Supabase
  connectivity issues from Render.
- Kill-switch: set `PLAN_ENFORCEMENT_ENABLED = false` in server.js + redeploy
  to stop blocking instantly without reverting code.

### PostHog (frontend analytics — us.i.posthog.com)
Initialized in `src/main.tsx`. Custom events:
- `posthog.identify(email, {plan, store_name, role})` on login/register
- `connect_attempt {platform}` — before every /connect fetch
- `connect_success {platform}` — connect OK
- `connect_failed {platform, reason, error/status}` — reasons:
  `unauthorized` | `server_error` | `network` | server-provided message
- `posthog.reset()` on logout

A spike in `connect_failed` broken down by `$browser` / seller identifies who
is having trouble going live and why.

### Other logging
- TikTok lifecycle logs in Render: "Connected to TikTok LIVE …",
  "TikTok rate limit cooldown …", "TikTok reconnect failed …",
  "TikTok health reconnect …"
- Frontend: `AppErrorBoundary` in `src/main.tsx` catches render crashes and
  shows a self-service reset screen.
- Render keep-alive self-ping every 5 min → "Keep-alive ping sent".

---

## Verification Commands

```bash
npm run lint        # ESLint (src/**/*.{ts,tsx}; server.js is NOT linted)
npm run typecheck   # tsc --noEmit (whole project refs)
npm run build       # Vite production build
npm run agent:check # all three, in order — must pass before any push
node --check server.js   # syntax-only check for server.js changes
```

Known gaps (do not assume these exist):
- **No test framework** — no Vitest/Jest, zero test files (planned, separate phase).
- **No CI** — no GitHub Actions; agent:check is manual discipline.
- ESLint does not cover `server.js` (flat config targets `**/*.{ts,tsx}` only).

### Baseline note (2026-06-11, main `070cc42`)

`npm run agent:check` currently **fails at the lint step** with 8 pre-existing
errors + 2 warnings, all in `src/App.tsx` (unused vars `BOT_FAQ_ICONS` /
`printerScanning` / `scanMobilePrinters` / `copy`; two
`react-hooks/set-state-in-effect`; two `react-hooks/purity` on `Date.now()`).
`npm run typecheck` and `npm run build` both pass. Until the owner approves a
lint-cleanup pass, treat **typecheck + build green** as the effective gate and
compare lint output against this known-error list — any NEW lint error is a
regression.
