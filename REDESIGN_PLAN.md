# SellerFlowLive — Full Redesign Plan

Branch: **`claude/full-redesign`** (off `main`). Reference: `design-redesign/`
(`README.md` = 16-screen spec; `SellerFlowLive.dc.html` = visual prototype).
The prototype's `support.js` workbench/sidebar harness is **NOT** built — only the
phone screens are the product.

> 🛑 **Production safety:** ALL work stays on `claude/full-redesign`. NEVER merge,
> push, or fast-forward into `main` until the owner explicitly says
> "merge to production" (only after iOS approval). Each step: show full diff +
> tests + constraint checklist, then WAIT for an explicit "go" before commit/push.

---

## The 16 screens (grouped by IA)

**Core (daily, exposed in bottom nav):**
1. Dashboard / Live — hero: LIVE badge, connection chips, streaming comment feed, MINE tags, claim/viewer counters.
2. Orders — order cards (buyer, @handle, items, #id, ₱total, status badge, platform, time); filter chips.
3. Products — 2-col inventory grid (colored header, initials, SKU, ₱price, stock bar ok/warn/danger).
4. Miners (analytics) — 2×2 stat cards + Top buyers list (rank, avatar, @handle, spent, orders).
5. Login / Landing — pre-auth, **no bottom nav**: accent hero band, stat chips, login form, Telegram help, 7-language switcher.

**Frequent (under Settings hub):**
6. Settings hub — 2-col tile grid, unique icon chip per tile, routes to every secondary screen.
6b. General Settings — Profile (once), Appearance (theme/accent/handle/language), Channels, Printer & Display, Account.
7. Customers — list (avatar, @handle, platform, spent, orders, last) + Comment archive.
8. Subscription — accent plan card (Pro, ₱/mo, renews, days left), included checklist, Renew via Telegram.
9. Support — Chat via Telegram, numbered user guide, version/legal footer.

**Admin / occasional:**
10. Admin — 3 stat cards (active/expiring/expired), sellers list, contact via Telegram.
11. Print Slip — receipt mock (mono, dashed dividers, TOTAL), Print to LAN / Share as image.
12. Sales Report — 2 summary cards, daily bar chart, top product.
13. Shipping — to-ship cards (buyer, #id, status, courier, tracking, Track ›).
14. Customer Data — Export CSV, data table (customer/orders/spent), encryption note.
15. Privacy & Terms — last-updated + numbered legal sections.
16. Delete Account — danger banner, "you'll lose" list, type-DELETE confirm, delete / keep buttons.

---

## Phase breakdown

### P1 — Foundation (THIS PHASE · additive only, no screens rebuilt)
- New branch `claude/full-redesign` off latest `main`.
- Load 3 Google Fonts (Space Grotesk, Plus Jakarta Sans, JetBrains Mono) — **load only, not applied**.
- `src/styles/design-tokens.css` — exact token system (light+dark, 6 accents), **scoped under `[data-redesign]`** so it cannot touch any existing screen.
- New logo asset `public/redesign/icon-180.png` (NEW path; existing `public/icon-180.png` untouched).
- This `REDESIGN_PLAN.md`.
- **After P1 the existing app looks + works 100% identically** (pure additive; tokens scoped to a `[data-redesign]` root that does not exist in the DOM yet).

### P2 — Core 5 screens (build new, behind `[data-redesign]`, off by default)
Dashboard/Live · Orders · Products · Miners · Login. New components consuming the
tokens + fonts; live feed animation, theme/accent engine (ThemeProvider). Still
gated/feature-flagged so production renders the current app unchanged.

### P3 — Frequent 4 screens
Settings hub + General Settings · Customers · Subscription · Support.

### P4 — Admin 7 screens
Admin · Print Slip · Sales Report · Shipping · Customer Data · Privacy & Terms · Delete Account.

### P5 — Wire REAL functions + Taiwan data
Replace prototype sample data and demo copy with the real app's data/logic:
real auth, live session, orders, products, buyers, printing, subscription, admin.
**Taiwan reality (do NOT implement before P5):**
- Currency **NT$** (prototype uses ₱/peso) — swap currency formatting.
- Demo persona "Maria's Live Shop / @maria_shops" → real seller data.
- Subscriptions are **manual via Wise + Telegram** (not in-app billing) — keep the
  Telegram-redirect model; no Play/App-store billing.
- Real sellers (~45–53 active); free tier 200 orders / rolling 30-day cycle.

### P6 — Vercel preview test + sign-off
Deploy branch preview; verify all 16 screens × light/dark × 6 accents for
readability + correctness on real devices. Owner reviews. **Merge to production
ONLY on explicit owner approval, AFTER iOS approval.**

---

## DO NOT TOUCH (every phase)

**Files / logic:**
- `src/App.tsx` logic, `src/App.css` rules, any existing screen markup/behavior.
- Logic files: `src/lib/*` (`orderLogic.ts`, `dateHelpers.ts`, `slipFields.ts`, …),
  `src/db.ts`, `src/accountDb.ts`, `supabase.ts`, `useTranslation.ts`,
  `src/translations.ts`.
- `capacitor.config.ts` `server.url` — must stay production
  `https://www.sellerflowlive.com/?apk=20260523-dark-mobile`.

**Behaviour / data:**
- The 6 tangled zones.
- Print geometry: `printSlip` mm dimensions, `STICKER_LABELS`, the 1–8 size scale,
  TSPL/ESC-POS builders, golden tests.
- Existing `localStorage` keys (billing/session/settings).
- `body.platform-ios` / `body.platform-android` hooks.
- The billing `orders` ledger + `check_and_increment_free_order` 200-cap trigger;
  `live_session_orders` table + RLS.
- Existing logo `public/icon-180.png`, `public/favicon.svg`.

**Process:**
- No commit/push without an explicit "go" for that step.
- NEVER merge/push/fast-forward to `main` until "merge to production".
- If a step would require touching any DO-NOT-TOUCH item → STOP and ask first.

---

## Token system (implemented in P1 — `src/styles/design-tokens.css`)

Scoped under `[data-redesign]`; theme via `[data-theme="light"|"dark"]`, accent via
`[data-accent="indigo|violet|emerald|rose|sky|amber"]`. Default = Light + Indigo.
Values byte-for-byte from `design-redesign/SellerFlowLive.dc.html` (token engine
L871–1019). Accent-derived rule: `--accent-fg`/`--handle` = accent **dark** shade
in light theme, **light** shade in dark theme (contrast in all 12 combos);
`--accent-soft` = base @ 12% (light) / 24% (dark); `--accent-softer` = 7% / 14%;
dark `--app-bg` is a radial gradient whose first stop is the accent's dark shade.
