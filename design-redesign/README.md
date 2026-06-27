# Handoff: SellerFlowLive — Mobile App Redesign

## Overview
SellerFlowLive is a **live-selling assistant** for TikTok / Facebook live sellers (mobile-first, used on Android phones; also works on web/tablet). During a live stream, buyers type **"mine"** in the comments to claim a product; the app auto-detects those claims ("miners"), builds order slips, tracks inventory, and helps the seller print/ship.

This package contains a **complete redesign of all 16 screens** in a clean, modern SaaS aesthetic (Stripe/Linear feel), with **dark and light themes** and **6 selectable accent colors**.

> **Note:** This README has two parts. The sections below describe the core 16-screen system. The **"Added features (v2)"** section at the very end documents everything layered on afterward (1-Click order tiers, channel account pickers, auto-detect setup, language picker, profile edit, printer consolidation, Admin control panels, notification bell). Read both — the v2 section is authoritative where it overlaps.

---

## About the Design Files
The files in this bundle are **design references created in HTML** — a single interactive prototype demonstrating the intended look, layout, and behavior. **They are not production code to copy directly.**

Your task is to **recreate these designs in the target codebase's environment** (React Native / Flutter / native Android / React web — whatever the app uses), following its established patterns, component library, and navigation. If no environment exists yet, pick the most appropriate framework (the app is mobile-first Android, so React Native or Flutter are natural choices) and implement there.

The prototype is built as one HTML file using a small custom component runtime (`support.js`). Treat it as a **visual + behavioral spec**, not an architecture to mirror. In particular:
- The prototype renders inside a simulated phone frame on a desktop "workbench" (left sidebar with theme/accent/screen switchers). **The workbench chrome is a demo harness only — do not build it.** Only the phone screens are the product.
- Theme/accent are driven by CSS custom properties set at runtime. In your app, implement these as a theming system (e.g. a ThemeProvider / design tokens).

---

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are specified below. Recreate the UI pixel-accurately using your codebase's libraries. Exact hex values, font sizes, radii, and copy are all documented.

---

## Themes

Two themes, switchable at runtime. The **default is Light + Indigo accent**.

### Light theme
| Token | Value | Use |
|---|---|---|
| `--app-bg` | `#f3f4fb` | App background |
| `--surface` | `#ffffff` | Cards, sheets, inputs |
| `--surface-2` | `#f6f7fc` | Subtle fills, inputs |
| `--surface-3` | `#eef0f9` | Track/rail fills |
| `--border` | `rgba(28,26,53,0.09)` | Hairline borders |
| `--border-strong` | `rgba(28,26,53,0.16)` | Input borders, dividers |
| `--text` | `#1c1a35` | Primary text |
| `--text-dim` | `#5a5872` | Secondary text |
| `--text-muted` | `#9795ad` | Tertiary / captions |
| `--header-bg` | accent base (e.g. `#4f46e5`) | Top app-bar band |
| `--on-header` | `#ffffff` | Text/icons on header band |
| `--shadow` | `0 1px 3px rgba(28,26,53,.08), 0 12px 28px rgba(28,26,53,.07)` | Card elevation |
| `--ok` / `--warn` / `--danger` | `#059669` / `#d97706` / `#e11d48` | Status colors |

### Dark theme ("automation" indigo look)
| Token | Value | Use |
|---|---|---|
| `--app-bg` | `radial-gradient(125% 95% at 50% -12%, <accent-dark> 0%, #15123f 46%, #0a0824 100%)` | App background (radial indigo→deep-violet→near-black). `<accent-dark>` swaps with the accent. |
| `--surface` | `rgba(255,255,255,0.055)` | Cards (translucent) |
| `--surface-2` | `rgba(255,255,255,0.03)` | Subtle fills |
| `--surface-3` | `rgba(255,255,255,0.09)` | Track/rail fills |
| `--border` | `rgba(255,255,255,0.10)` | Hairline borders |
| `--border-strong` | `rgba(255,255,255,0.18)` | Stronger borders |
| `--text` | `#ffffff` | Primary text |
| `--text-dim` | `#c2c9ee` | Secondary text |
| `--text-muted` | `rgba(224,231,255,0.5)` | Tertiary / captions |
| `--header-bg` | `rgba(16,12,46,0.62)` + backdrop blur | Top app-bar (translucent) |
| `--on-header` | `#ffffff` | Text on header |
| `--shadow` | `0 10px 30px rgba(0,0,0,0.45)` | Card elevation |
| `--ok` / `--warn` / `--danger` | `#34d399` / `#fbbf24` / `#fb7185` | Status colors (brighter for dark) |

Dark theme also layers a subtle **animated grid** (1px lines, `rgba(255,255,255,.045)`, 38px cells, slow drift) and two soft **radial glows** (accent + cyan `rgba(34,211,238,.34)`) behind content. These are decorative; reproduce as a low-cost background layer.

---

## Accent system

One accent drives buttons, links, active nav, the header band, highlights, and the dark-bg tint. **6 presets**, each with three shades:

| Name | base | light (dark-theme accent text) | dark (light-theme accent text / bg start) |
|---|---|---|---|
| Indigo (default) | `#4f46e5` | `#a5b4fc` | `#3730a3` |
| Violet | `#7c3aed` | `#c4b5fd` | `#5b21b6` |
| Emerald | `#059669` | `#34d399` | `#065f46` |
| Rose | `#e11d48` | `#fda4af` | `#9f1239` |
| Sky | `#0284c7` | `#7dd3fc` | `#075985` |
| Amber | `#d97706` | `#fcd34d` | `#b45309` |

Derived accent tokens (computed from the selected accent):
- `--accent` = base — filled buttons, active nav fill, toggles, header band (light).
- `--accent-text` = `#ffffff` — text on filled accent.
- `--accent-fg` = **light shade in dark theme, dark shade in light theme** — accent-colored *text/links* (guarantees contrast in both themes regardless of accent).
- `--handle` = same rule as `--accent-fg` — **dedicated readable color for @username handles** (critical: handles must never be low-contrast).
- `--accent-soft` = base @ 12% (light) / 24% (dark) — soft accent backgrounds, active-nav pill.
- `--accent-softer` = base @ 7% (light) / 14% (dark).

**Readability rule (must honor):** every text/input/label must stay clearly legible in all 12 theme×accent combos. Achieve this by using `--accent-fg`/`--handle` (contrast-adjusted) for accent-colored *text*, and reserving raw `--accent` for *filled* surfaces with white text.

---

## Typography
Three families (Google Fonts):
- **Space Grotesk** (500/600/700) — brand wordmark, screen titles, section headers, big numbers in cards.
- **Plus Jakarta Sans** (400/500/600/700/800) — all UI text, body, labels, buttons.
- **JetBrains Mono** (500/600/700) — numeric/tabular data: prices (₱), order numbers (#10472), counts, timers, SKUs.

Type scale used (px): screen title 19 / hero 21–25 / section header 14.5 / card big-number 22–26 / body 13–14 / label 12 / caption 11–11.5 / micro 10–10.5. Title letter-spacing ≈ `-0.01em` to `-0.02em`. Mobile minimum hit target 44px.

Currency is **Philippine peso (₱)** throughout (SE-Asia live-selling market; Telegram-based subscription/support).

---

## Global layout primitives
- **Phone screen** = vertical flex column: status bar (top) → scrollable content (`flex:1`) → bottom nav (except Login). Design width ~390px.
- **Top app-bar** per screen: sticky, `background:var(--header-bg)`, `color:var(--on-header)`, padding `14px 16px`, title in Space Grotesk 19/700. In light theme this is the **accent header band**; in dark it's a translucent blurred bar.
- **Cards**: `background:var(--surface)`, `1px var(--border)`, radius 15–16px, `box-shadow:var(--shadow)`, padding 13–16px.
- **List rows**: 12–14px padding, `1px var(--border)` bottom divider, leading avatar/icon (circle or 10–12px rounded square), title + sub, trailing value/status.
- **Avatars**: deterministic color from name hash, palette `['#f59e0b','#ef4444','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#6366f1']`, white 2-letter initials.
- **Status badge**: small pill, `font-weight:800`, color = status color, on `var(--surface-2)` with `1px var(--border)`.
- **Primary button**: `background:var(--accent)`, white text, radius 11–13px, `box-shadow:0 4–6px var(--accent-soft)`, weight 700.
- **Secondary button**: `background:var(--surface-2/--surface)`, `1px var(--border-strong)`, `color:var(--text)`.
- **Inputs**: `background:var(--surface-2)`, `1px var(--border-strong)`, radius 12px, padding `13px 14px`, `color:var(--text)`, label in `--text-dim` 12/600.

### Bottom navigation (single, clean — no duplicate nav surfaces)
5 tabs: **Live · Miners · Orders · Products · Settings**. Each: stacked icon (22px stroke) + 10px/700 label. Active tab uses `color:var(--accent-fg)` with `background:var(--accent-soft)` pill; inactive uses `var(--text-muted)`. The **Settings** tab opens the full-screen Settings hub (see below) and is "active" whenever any Settings/admin sub-screen is showing. Hidden on the Login screen.

---

## Screens / Views (16)

> Grouping mirrors the app's IA: **Core** (daily), **Frequent**, **Admin/occasional**. The bottom nav exposes Live/Miners/Orders/Products directly; everything else lives under the **Settings** hub.

### 1. Dashboard / Live  *(Core — the hero screen)*
- **Purpose:** run a live session — watch comments stream in, see claims captured.
- **Top app-bar:** pulsing red **LIVE** badge (red dot animates, badge has expanding ring pulse ~1.8s), title "Tonight's Live", right side shows two header chips: **viewer count** (eye icon) and **claim count** (bag icon), both live-ticking. Below the title: two connection chips — `TikTok · @maria_shops` and `Facebook`, each with a green dot.
- **Content:** section header "Live comments" + small pulsing red dot + "Auto-detecting 'mine'". Then the **comment feed** card (`flex:1`, fills remaining height): rows of avatar + name (13/700) + **@handle in `--handle`** + relative time, with the comment text below; comments that contain a claim get a small **MINE** tag (`--accent` fill, white, 800). New comments stream in at top every ~2.7s; list capped ~11.
- **Behavior:** a timer prepends synthetic comments from a pool; "mine" ones bump the claim counter and briefly flash. Viewer count jitters. LIVE badge + dots pulse continuously.

### 2. Orders  *(Core)*
- **Purpose:** review orders from the live.
- **Top app-bar:** title "Orders" + "Today · N" chip + horizontal filter chips (All / Unpaid · 2 / Paid · 2 / Shipped); active chip = white bg with `--accent` text.
- **Content:** order cards. Each card: avatar + buyer name (14.5/700) + @handle, item summary line (dim, truncated); right-aligned order # (mono, muted) + total `₱{amount}` (mono 16/700). Footer row: status badge + platform + "{time} ago".
- **Sample statuses & colors:** Unpaid `#e11d48`, Paid `#059669`, Packed `#0284c7`, Shipped `#7c3aed`, Delivered `#059669`.

### 3. Products  *(Core)*
- **Purpose:** inventory grid + add product.
- **Top app-bar:** "Products" + "+ Add" button (white bg, accent text) + category chips (All/Beauty/Apparel/Home).
- **Content:** 2-col grid of product cards. Each: 84px colored header block with big initials + category tag; body with name (13.5/700), SKU (mono, muted), price `₱{n}` (mono 16/700), a **stock bar** (height 5px) whose width = stock/120 and color = `--ok` (≥10) / `--warn` (<10) / `--danger` (0), and a stock label ("42 in stock" / "Low · 8 left" / "Out of stock").

### 4. Miners (analytics)  *(Core)*
- **Purpose:** buyer analytics. "Miners" = buyers who claimed via "mine".
- **Top app-bar:** "Miners" + subtitle "Buyers who claimed 'mine'" + "30 days ▾".
- **Content:** 2×2 stat cards — **Total buyers** 1,284 (▲12%), **Total orders** 3,947 (▲8%), **Total spent** ₱1.28M (₱325 avg), **Platforms** split (TikTok 64% / Facebook 36%). Then "Top buyers" list: rank # + avatar + name + @handle, right side spent (mono) + "N orders".

### 5. Login / Landing  *(Core — pre-auth, no bottom nav)*
- **Purpose:** marketing hero + login.
- **Layout:** accent **hero band** at top (`--header-bg`) with brand logo (image) + wordmark, headline "Turn every live comment into a paid order." (Space Grotesk 25/700), sub-copy. Decorative translucent circle top-right.
- **Body:** 3 stat chips (12k+ sellers / 2.4M orders / 4.9★). "Welcome back" + Phone/email input + Password input + "Forgot password?" (accent text, right) + full-width **Log in** button (→ Dashboard). Directly under Log in: "New here? **Create account**" (centered).
- **Footer (sticky bottom):** left = **"Need help?"** with a Telegram glyph (rounded square `#0088cc` + paper-plane); right = **globe language switcher** (globe icon + current flag + ▾) opening a popover of **7 languages with country flags**: English 🇺🇸, Filipino 🇵🇭, Bahasa Indonesia 🇮🇩, Tiếng Việt 🇻🇳, 中文 简体 🇨🇳, 中文 繁體 🇹🇼, ไทย 🇹🇭. Below, centered: "By continuing you agree to our **Terms**".

### 6. Settings (hub)  *(Frequent — full screen, opened by the Settings bottom-nav tab)*
- **Purpose:** menu hub to every secondary destination.
- **Layout:** app-bar "Settings" + subtitle "Shop tools & account". 2-col grid of tiles; each tile = card with a **36px rounded-square icon chip** (`--accent-soft` bg, `--accent-fg` icon) + label. **Every tile has a unique icon:**
  - General Settings — gear
  - Language — globe
  - Customers — two people
  - Admin — shield + check
  - Sales Report — bar chart
  - Shipping — truck
  - Customer Data — database
  - Privacy & Terms — document + lock
  - Delete Account — trash (red chip `rgba(225,29,72,.13)`, `--danger` icon)
  - Log out — exit-door arrow (neutral chip)
- Tapping a tile navigates to that screen (Language → General Settings; Log out → Login).

### 6b. General Settings  *(reached from the hub / nav)*
Grouped sections, each a labeled card group:
- **Profile** (appears ONCE — not duplicated anywhere): 54px avatar "MS", "Maria's Live Shop", `@maria_shops` (in `--handle`), "Pro plan · renews Jul 28", **Edit** button.
- **Appearance** card: **Theme** segmented control (☀ Light / ☾ Dark — drives the live theme), **Accent color** 6 swatches (40px rounded, selected = ring + ✓), **Readable @handles** toggle row (shows live `@maria_shops` in `--handle`), and **Language** row ("English (US) ▾").
- **Channels:** TikTok Live (`@maria_shops`, Connected) + Facebook Live (Connected), each with brand glyph + green "Connected".
- **Printer & Display:** Receipt printer (LAN · 192.168.1.42 · 58mm · Ready), Bluetooth printer (Pair · Off), Display & text size (Large · keep screen awake), and **Print order slip** (→ Print screen; 58mm receipt · GCash details).
- **Account:** Subscription (Pro · Jul 28 ›), Support & user guide (›), Delete account (`--danger` ›).

### 7. Customers  *(Frequent)*
Top app-bar "Customers" + "1,284 total" + search field ("Search name or @handle"). Customer list rows (avatar, name, @handle · platform, right: spent mono + "N orders · {last}"). Below: **Comment archive** card — past comments (avatar, name, @handle, timestamp, text).

### 8. Subscription  *(Frequent)*
Top "Subscription". Large accent **plan card** (gradient `--accent`, white text): "CURRENT PLAN", **ACTIVE** pill, "Pro", "₱499 / month", "Renews Jul 28, 2026", "33 days left". "Included in Pro" checklist (✓ in `--ok`). **Renew via Telegram** button (`#0088cc`, paper-plane). Helper: "Message @SellerFlowSupport to renew or upgrade".

### 9. Support  *(Frequent)*
Top "Support". "Need a hand?" card → **Chat with @SellerFlowSupport** Telegram button. "User guide" numbered list (1–4: connecting channels, how "mine" works, printing/shipping, renewing). Footer: "SellerFlowLive v4.2 · Privacy & Terms".

### 10. Admin  *(Admin)*
Top "Admin" + "Seller management" + "12,480 sellers". 3 stat cards (Active 9,842 `--ok` / Expiring 418 `--warn` / Expired 2,220 `--danger`). Sellers list (shop avatar, shop name, owner · plan, right: status color + expiry). **Contact seller via Telegram** button.

### 11. Print Slip  *(Admin)*
Top "Print slip" with back arrow (→ Orders). A **receipt mock** (white card, JetBrains Mono, dashed dividers): shop header (Maria's Live Shop · @maria_shops · TikTok Live), ORDER/BUYER/DATE rows, line items with prices, **TOTAL ₱897**, footer "Thank you for shopping live! · Pay via GCash · 0917 555 0142". Buttons: **Print to LAN printer** (accent), **Share as image** (secondary).

### 12. Sales Report  *(Admin)*
Top "Sales report" + "This week ▾". Two summary cards (This week ₱114.4k ▲18% / Orders 352 · ₱325 avg). **Daily sales bar chart** (7 bars, `--accent`, height = value/max, day labels). "Top product" card (Matte Lipstick — Red, 184 sold, ₱45.8k).

### 13. Shipping  *(Admin)*
Top "Shipping" + "4 to ship". Cards: buyer avatar + name + order # (mono), status badge; footer row courier (J&T Express / LBC / Flash) + tracking # (mono, accent) + "Track ›".

### 14. Customer Data  *(Admin)*
Top "Customer data" + "Admin export" + **Export CSV** button. A data table: header row (CUSTOMER / ORDERS / SPENT) then customer rows (name + @handle, orders mono, spent mono). Note line: "Customer data is encrypted and handled per our Privacy Policy. Export access is logged."

### 15. Privacy & Terms  *(Admin)*
Top "Privacy & Terms". "Last updated Jun 1, 2026" then numbered legal sections (1 Data we collect, 2 How we use it, 3 Your rights, 4 Contact). Body text in `--text-dim`, `line-height:1.65`.

### 16. Delete Account  *(Admin)*
Top "Delete account" with back (→ Settings). Danger banner card (`--danger` border, warning triangle, "This can't be undone"). "You'll lose" list (✕ in `--danger`: 3,947 orders, 1,284 customers, sales history, Pro subscription). "Type DELETE to confirm" input. **Permanently delete account** button (`--danger`, white). **Keep my account** secondary button (→ Settings).

---

## Interactions & Behavior
- **Navigation:** bottom nav switches Core screens; the Settings tab opens the full-screen Settings hub; hub tiles and in-screen links route to sub-screens. Back arrows on Print/Delete return to their parent. Login's "Log in" → Dashboard; "Log out" → Login.
- **Theme & accent:** changing theme (segmented control) or accent (swatches) updates CSS variables app-wide instantly. Persist the user's choice.
- **Live feed (Dashboard):** comments prepend on a ~2.7s interval (cap ~11); "mine" comments increment the claim counter and flash; viewer count jitters; LIVE badge/dots pulse via CSS keyframes.
- **Language switcher (Login):** tap globe → popover of 7 languages; selecting one updates the current flag/label and closes the popover.
- **Status/stock coloring:** computed from value (see Orders/Products/Admin).
- **Animations/keyframes used:** `livePulse` (badge ring, 1.8s), `dotPulse` (1s), grid drift (7s linear), glow float (9–11s ease-in-out), sheet/rise entrances (~0.26s `cubic-bezier(.22,1,.36,1)`). Keep durations/easings.

## State Management
- `theme`: `'light' | 'dark'` (default `light`).
- `accent`: one of `indigo|violet|emerald|rose|sky|amber` (default `indigo`).
- `screen`: current route/screen id.
- `lang`: selected language code (default `en`); `langOpen`: popover open.
- Live data on Dashboard: `comments[]` (streaming), `liveClaims`, `viewers`, `slipFlash`.
- All list data (orders, products, miners, customers, shipping, sellers, sales) is static sample data in the prototype — wire to real APIs in the app.

## Design Tokens (summary)
- **Colors:** see Themes + Accent tables above. Status: ok/warn/danger per theme. Avatar palette listed under primitives.
- **Spacing:** card padding 13–16px; screen content padding ~14px; gaps 9–12px; list-row padding 12–14px.
- **Radius:** inputs/buttons 11–13px; cards 15–16px; icon chips 10–12px; pills/badges 7–9px; avatars 50% (people) or 10–12px (shops/products); phone screen 36px.
- **Shadows:** `--shadow` per theme (light: `0 1px 3px rgba(28,26,53,.08), 0 12px 28px rgba(28,26,53,.07)`; dark: `0 10px 30px rgba(0,0,0,.45)`).
- **Type scale & families:** see Typography.

## Assets
- **Logo:** `assets/icon-180.png` (also at `uploads/icon-180.png`) — purple shopping-bag-with-"S" mark, motion lines, pink dot. Provided by the client. Used at top-left of the Settings-hub/sidebar brand and in the Login hero. 180×180 PNG.
- **Icons:** inline stroke SVGs (gear, globe, people, shield, bar chart, truck, database, doc-lock, trash, exit, eye, bag, printer, speaker, monitor, Telegram paper-plane, brand glyphs). Replace with your icon library's equivalents (1.5–1.7px stroke weight to match).
- **Flags:** emoji flags in the language switcher.
- **Fonts:** Space Grotesk, Plus Jakarta Sans, JetBrains Mono (Google Fonts).

## Files
- `SellerFlowLive.dc.html` — the full interactive prototype (all 16 screens, theme/accent engine, live feed). Open in a browser to explore; use the left workbench to switch theme, accent, and screen. **The workbench is a demo harness — do not build it.**
- `support.js` — the prototype's component runtime (required to render the HTML; **not** for production).
- `assets/icon-180.png`, `uploads/icon-180.png` — the client logo.

---

## Added features (v2) — authoritative

Everything below was added after the initial 16-screen system. All of it lives on the **Dashboard** and inside **Settings** / **Admin**, reusing the same tokens, card styles, and the theme/accent engine. State is React-class component state in the prototype; recreate with your app's state/store.

### Dashboard / Live
- **Header counters:** the app-bar shows live **viewer count** (eye icon) and **claims** count (bag icon); both tick during the live. The big "Claims this live" / "Elapsed" stat cards and the bottom order-slip card were **removed** so the live comment feed fills the screen.
- **Channel account pickers:** the TikTok and Facebook connection chips are **dropdown buttons**. Tapping one opens a panel listing connected accounts to pick from (TikTok: @maria_shops / @maria_beauty / @mariadeals with follower counts; Facebook: Maria's Live Shop / Maria Beauty Hub / Reseller Group PH). Selected account shows a ✓; opening one closes the other. State: `ttOpen/fbOpen`, `ttIdx/fbIdx`.
- **Auto-detect / Manual toggle:** in the "Live comments" header, a switch toggles auto-detect of "mine" (accent = on, label "Auto-detect") vs "Manual mode" (off, claims stop auto-incrementing). State: `autoDetect`. Bound to the same state as the Settings → Auto mode toggle (changing one changes both).
- **Per-comment actions:** every comment shows two right-aligned buttons on a second line — an outlined **Enterprise** button and a filled **1-Click** button (lightning icon). 1-Click = create the order instantly from that buyer's comment; Enterprise = the premium auto-order tier.

### Settings (General Settings detail screen)
- **Profile → Edit:** the Edit button on the profile card expands a **Basic Information** form (Shop name; Owner name + Phone row; Username handle in the readable `--handle` color; Email; Pickup/return address) with a Save button. Button label flips Edit ↔ Close. State: `profileOpen`.
- **Appearance:** theme segmented control (drives live theme), 6 accent swatches (selected = ring + ✓), Readable @handles toggle, and a **Language** row.
- **LIVE SESSION → Auto mode:** a row with an on/off toggle (same `autoDetect` state as the Dashboard). Tapping the row label **expands an auto-detect setup**: **Trigger word sets** — chips for 5 defaults (mine, claim, sold, get, take), each removable with ×, plus a **text input** ("Type word, press Enter") to add custom trigger words up to a **/ 20** limit (ignores blanks/dupes). State: `autoSetupOpen`, `autoWords[]`, `autoInput`. A comment matching any trigger word auto-creates the order.
- **Printer & Display:** all printers are consolidated into ONE **Printer** row showing the selected printer; tapping it expands a **CHOOSE PRINTER** list (Receipt printer LAN · Bluetooth printer · Label/sticker printer USB) with radio selection + live status. Then a **Display & text size** row. State: `printerOpen`, `printerIdx`.

### Settings hub (full-screen, opened by the bottom-nav Settings tab)
- The hub grid tiles each have a **unique icon**. The **Language** tile opens a **language picker modal** listing **7 languages with country flags**: English 🇺🇸, Filipino 🇵🇭, Bahasa Indonesia 🇮🇩, Tiếng Việt 🇻🇳, 中文 简体 🇨🇳, 中文 繁體 🇹🇼, ไทย 🇹🇭 (current is checked; picking applies + closes). State: `lang`, `langPickerOpen`. The same 7-language picker also appears as a popover on the Login screen.

### Admin → owner control panel
The Admin screen is an **owner control center**: owner identity card (Juan Dela Cruz · Platform owner · SUPER ADMIN), **notification bell** (icon-only, in the header, with an urgent red dot), KPI grid (Total sellers 12,480 · Monthly revenue ₱4.2M · New today 38 · Open tickets 7), a Subscriptions health row (Active 9,842 / Expiring 418 / Expired 2,220), and a **Controls** grid of 6 tiles. Each control tile opens a **bottom-sheet panel** (title + × close). State: `adminPanel` (= null | 'sellers' | 'plans' | 'payments' | 'reports' | 'system' | 'broadcast').
- **Sellers** — search, status filter chips, Add seller / Suspend / Message actions.
- **Plans** — the three subscription tiers (Starter ₱199, Pro ₱499, Enterprise ₱1,499) with seller counts + features + New plan.
- **Payments** — collected-today + pending summary and a recent transactions list (seller, method GCash/Maya/Bank, amount, Paid/Pending).
- **Reports** — MRR / Growth / Churn / ARPU cards, report links, Export CSV.
- **System (assign plan by payment)** — type the amount a new seller paid; it **auto-matches the plan** (`amt ≥ 1499 → Enterprise`, `≥ 499 → Pro`, `≥ 199 → Starter`, else —) shown in a highlighted card, then a seller selector and a **Grant {plan} plan** button. State: `assignAmount`, derived `matchedPlan`.
- **Broadcast** — audience chips + message composer + Send.

### New state summary (v2)
`ttOpen, fbOpen, ttIdx, fbIdx, autoDetect, oneClickTier, autoSetupOpen, autoWords[], autoInput, profileOpen, printerOpen, printerIdx, lang, langPickerOpen, adminPanel, assignAmount`. All sample lists (TT_ACCOUNTS, FB_ACCOUNTS, LANGS, PLANS, PAYMENTS, PRINTERS, sellers, etc.) are static prototype data — wire to real APIs.

### Interaction patterns introduced
- **Expandable inline panels** (Auto mode setup, Printer chooser, Profile edit): a row toggles a panel beneath it within the same card; chevron rotates.
- **Dropdowns** (channel pickers): absolute-positioned panel under a header button; opening one closes the other.
- **Modals / bottom sheets** (language picker = centered modal; Admin control panels = bottom sheet with `sflSheet` slide-up keyframe): dismiss via × or selecting an item.
- **Editable chip input** (trigger words): typed input + Enter appends a chip; × removes; capped at a max.
- **Derived/computed value** (System assign-by-payment): a number input drives a computed matched-plan label live.

---

## Added features (v3) — authoritative (supersedes v2 where they overlap)

Refinements after v2, all theme/accent-aware, same patterns.

### Dashboard / Live
- The big stat cards were replaced; header now has a **Session length selector** (top-down dropdown: **1 / 2 / 3 days**, default 1 — "ship same day" vs multi-day live before shipping). State: `sessionDays`, `sessionOpen`.
- The header title reads **"SellerFlowLive"**. The **Auto-detect toggle was removed from the Dashboard** (now lives only in Settings → Auto mode); default is **Manual mode (auto-detect OFF)** — sellers opt in.
- **Channel chips → connect flow:** chips start **not connected** (neutral). Pick an account in the dropdown, then press **Connect** → "Connecting…" → chip turns **green** (connected highlight: green bg + inset border + glowing pulsing dot). **Disconnect** returns to neutral. Each dropdown has **Refresh** + **Connect** footer buttons. State: `ttConnected/fbConnected`, `ttConnecting/fbConnecting`.
- **Per-comment auto-print:** with Auto-detect ON, any comment containing a trigger word **auto-prints** and shows an **"Auto-printed {price}"** badge (price comes from the trigger word's set price). **1-Click** = manual print (shows "Printed {price}" ~1.6s then reverts to the buttons). **Enterprise** = tap → inline price input → **Enter** auto-prints at the typed price, then reverts. Trigger words now carry a **price** (e.g. `hello = 150`) editable in Settings → Auto mode.

### Settings
- **Profile → Edit** form: Pickup/return address field removed (now Shop name, Owner+Phone, Username handle, Email).
- **Auto mode setup** (trigger word sets): each chip shows **word + price**; type `word=price` then **Enter** to add (up to 20).
- **Printer & Display:** the **"LIVE print pattern"** row opens a full screen — a live **slip preview** (fixed SellerFlowLive logo + Session date + Shop name + Buyer # + TikTok name/username + Comment) where each field has a **toggle + size stepper (− 1× +)**; toggling/​resizing updates the preview live (off = field disappears, freeing space); the logo is fixed. **Printer Test** + **Save settings** buttons. State: `pp{...}`.
- The **Printer** row's chooser items open a **Printer settings** screen: **Receipt printer → WiFi/LAN** view (saved-printer status, OUTPUT FORMAT Receipt/Sticker, IP + Port, Find/Test Connection/Connect/Test Print). **Bluetooth printer →** Bluetooth view (No-printer status, **Sticker size** dropdown with 100×60/80×60/80×50/70×50/60×40mm, Scan paired Bluetooth printers). Compact, WiFi-only on the receipt page. State: `psType`, `psOut`, `psSize`, `psSizeOpen`.
- **Appearance** is compact; **Language** and **Currency** are two aligned **top-down dropdown rows**. **Currency** is a **global app-wide setting** (default **USD $**) with 7 options matching the 7 languages: USD $, PHP ₱, IDR Rp, VND ₫, CNY ¥, TWD NT$, THB ฿. Changing it re-renders **every price in the app** via a `cur` symbol token. State: `currency`, `apLangOpen`, `apCurOpen`.

### Login / Auth
- **Forgot password?** → Telegram popup ("Reset your password" — admin-only reset; "Maybe next time" / **Next →** opens `https://t.me/SellerFlowSupport`). State: `loginModal`.
- **Create account** → a real **signup screen** (pre-auth, no bottom nav): Shop name, Owner name + Phone, Username handle, Email, Password + Confirm; "Create account" → Dashboard; "Already have an account? Log in". Screen id `signup`.

### Admin → owner control center (expanded)
- Owner card trimmed (no caption line). **KPI grid** = **Monthly revenue** (clickable) + **New today / sign-ups to approve** (clickable). Total sellers & Open tickets cards and the "Recent sellers" list were **removed** (sellers now live in the Sellers → Users panel).
- **Notification bell** is functional: a **live counter badge** (currently 5 = new sign-ups + subscriptions expiring ≤5 days) opens a **Notifications** panel listing each (color-coded: accent = sign-up, amber = expiring). Panel id `notifs`.
- **Subscriptions** = **4 clickable boxes** (2×2): **Active paid**, **Expiring ‹15d**, **Free tier** (new — free shops with plan + free cycle), **Expired**. Each opens a detail panel listing the relevant shops. Panel ids `subActive/subExpiring/subFree/subExpired`.
- **New today** card → **New sign-ups to approve** panel: pending accounts from the signup flow, each with **Approve / Reject**. Panel id `signups`; data `SIGNUPS`.
- **Monthly revenue** card → **App revenue** panel: this-month total, platform fees, **net profit**, **revenue by plan** (subscribers × price), Export. Panel id `revenue`.
- **Sellers** control → full **Users management** list (replaces old seller cards): per-user card with email + note, **Role** badge (Admin/Seller), **Plan** badge, **Days** + **Accounts**, **plan tier quick-set** (Free/Basic/Pro/Master), and actions (Edit · Reset PW · Make Admin/Remove Admin · Expire · Delete). Data `USERS`.
  - **+ Add days** per user: tap → number input → **Enter** adds to that user's remaining **Days** (e.g. paid 2 months → type 60 → +60). State: `userDays{}`, `addIdx`, `addVal`.
  - **Dynamic revenue:** the plan tier buttons actually **change the user's plan**, and the change is **detected as profit** in the App revenue panel (a live "Detected from plan changes: +{cur}{amount}" line). Prices: **Basic NT$500 · Pro NT$1,200 · Master NT$1,700 · Free 0** (`PLAN_PRICE` map). State: `userPlans{}`.

### Currency note
All prices in the prototype are rendered through a single `cur` symbol (from `CURRENCIES[currency]`). Numeric values are stored without a symbol; in production keep currency as a user/region setting and format centrally.

### Full state summary (v3 additions)
`sessionDays, sessionOpen, ttConnected, fbConnected, ttConnecting, fbConnecting, autoDetect(false default), autoWords[{word,price}], printed{}, entId, entPrice, pp{...}, psType, psOut, psSize, psSizeOpen, currency, apLangOpen, apCurOpen, loginModal, screen:'signup', adminPanel(+ subActive/subExpiring/subFree/subExpired/signups/revenue/notifs), userDays{}, userPlans{}, addIdx, addVal`.
