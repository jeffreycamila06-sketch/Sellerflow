# Handoff: SellerFlowLive — Marketing Landing + Web Dashboard

## Overview
SellerFlowLive is a tool for live sellers (Facebook / TikTok / Instagram live) that turns
live comments into paid, printed orders. This package contains two design references:

1. **Landing page** (`SellerFlow Landing.dc.html`) — the public marketing site: nav, hero,
   features, how-it-works, pricing, FAQ, CTA, footer.
2. **Web dashboard + login** (`SellerFlow Web Dashboard.dc.html`) — the authenticated app:
   a split-screen login and the seller dashboard (sidebar, stats, sales chart, live-session
   panel, recent-orders table).

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing the
intended look and behavior, **not production code to copy directly**. They are authored as
"Design Components" (a streaming HTML format) and depend on `support.js`; that runtime is a
prototyping tool, **not** something to ship.

Your task is to **recreate these designs in the target codebase's existing environment**
(React, Vue, Next.js, etc.) using its established patterns, component library, and styling
approach. If no front-end environment exists yet, choose the most appropriate modern stack
(e.g. React + Tailwind or CSS Modules) and implement there. Lift the exact tokens below;
re-implement the markup idiomatically.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are all
intended as shown. Recreate pixel-accurately using the codebase's libraries. All hex values,
font sizes, and spacing in this README are authoritative.

---

## Design Tokens

### Fonts (Google Fonts)
| Role | Family | Weights used |
|---|---|---|
| Headings / display | **Space Grotesk** | 500, 600, 700 |
| Body / UI | **Plus Jakarta Sans** | 400, 500, 600, 700, 800 |
| Numbers / prices / mono | **JetBrains Mono** | 500, 700 |

Import:
```
https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap
```

### Colors
| Token | Hex | Use |
|---|---|---|
| Primary indigo | `#4F46E5` | buttons, links, accents |
| Indigo accent | `#6366F1` | gradient end, secondary accent |
| Indigo light (gradient tail) | `#818CF8` | hero gradient text, master checks |
| Primary gradient | `linear-gradient(135deg, #4F46E5, #6366F1)` | primary buttons |
| Hero text gradient | `linear-gradient(120deg, #4F46E5, #6366F1 60%, #818CF8)` | "selling." word |
| Page background | `#FAFAFE` | body (off-white w/ purple tint) |
| Card background | `#FFFFFF` | cards, nav |
| Card border | `#ECECF5` | card / divider borders |
| Input/secondary border | `#E4E2F0` / `#E0DDF0` | inputs, secondary buttons |
| Dark band / ink | `#171530` | how-it-works band, footer, Master card, dark buttons |
| Heading text | `#171530` | h1/h2 |
| Body text | `#4A4860` | paragraphs |
| Muted text | `#6A6880` / `#8A88A0` | captions, fine print |
| Pill bg (indigo) | `#EFEEFE` border `#E0DDFA` | hero kicker pill |
| Success green | `#10B981` / `#16A34A` | free-plan checks, "captured" |
| Live rose | `#F43F5E` / `#E11D48` | LIVE badge, live dot |
| Telegram blue | `#27A7E7` | telegram icon chip |

Accent color is themeable — indigo is the default of 6 presets, but only indigo is used here.

### Spacing / Layout
- Content container: `max-width: 1200px`, side padding `32px`, centered. FAQ container `760px`.
- Section vertical rhythm: top padding `96px` between major sections.
- Min page width: `1100px` (desktop-first; mobile breakpoints TBD by dev).
- Hero grid: 2 columns `1.05fr / 0.95fr`, gap `56px`, vertically centered.
- Features grid: 3 columns, gap `20px`.
- Pricing grid: 4 columns, gap `18px`, `align-items: stretch`.
- Metrics grid: 4 columns, gap `18px`.

### Border radius
| Element | Radius |
|---|---|
| Buttons (primary/secondary) | `12–14px` |
| Small chips / pills | `99px` (full) |
| Cards (feature, metric) | `18–20px` |
| Pricing cards | `22px` |
| Large bands (how-it-works, CTA) | `28px` |
| Hero product card | `24px` |
| Inputs (dashboard login) | `16px` |
| Nav buttons | `11–12px` |

### Shadows
- Primary button: `0 10px 22px -8px rgba(79,70,229,0.5)` (nav) / `0 16px 30px -10px rgba(79,70,229,0.5)` (hero).
- Hero product card: `0 40px 80px -30px rgba(79,70,229,0.4)`.
- Pricing Pro (highlighted): `0 30px 60px -24px rgba(79,70,229,0.45)`.
- Pricing Master (dark): `0 30px 60px -24px rgba(23,21,48,0.5)`.
- Feature hover: `0 24px 50px -22px rgba(79,70,229,0.32)`, lifts `translateY(-4px)`.

---

## Screens / Views

### 1. Landing — Sticky Nav
- Sticky top, `height 72px`, bg `rgba(250,250,254,0.82)` + `backdrop-filter: blur(14px)`,
  bottom border `#ECECF5`.
- Left: logo (38px) + wordmark "SellerFlow**Live**" (Space Grotesk 19/700, "Live" in `#4F46E5`).
- Center links: Features, Pricing, FAQ (Plus Jakarta 14.5/600, `#4A4860`, hover `#4F46E5`),
  anchor to `#features`, `#pricing`, `#faq`.
- Right: **language switcher** (globe + current code + chevron, dropdown of 7 langs),
  "Log in" text link, "Start free" primary gradient button (42px tall).

### 2. Landing — Hero
- Kicker pill: "For live sellers on FB, TikTok & IG" (indigo pill).
- H1: **"Stop typing."** / **"Start selling."** — Space Grotesk **64px / 700**,
  line-height 1.04, letter-spacing `-2px`. "selling." uses the hero text gradient.
- Sub: Plus Jakarta 18/400, `#4A4860`, max-width 480px:
  "Turn every live comment into a paid order. Capture orders, manage buyers, and print
  receipts in one click."
- CTAs: "Start free" (primary gradient, 54px) + "See how it works" (secondary white, border
  `#E0DDF0`, play icon) → anchors to `#how`.
- Social proof: overlapping avatar stack (4) + "**12,000+ sellers** closing orders live every day".
- **Right: product visual card** — white card, the money shot. Contains:
  - LIVE badge (`128 watching`) + mono timer `32:14`.
  - Comment feed (grey `#F6F6FC` inner card): two comments; the second shows a `MINE 04`
    chip (indigo) + green "captured".
  - Auto-created order row (primary gradient): "AUTO-CREATED ORDER · #1042 / Crystal Lim ·
    Item 04 / ₱980 (mono)".
  - Two buttons: "1-click print" (dark `#171530`) + "Send pay link" (white outline).

### 3. Landing — Metrics strip
4 white bordered cards: value in **JetBrains Mono 30/700 `#4F46E5`** + label.
Values: `12k+` Active sellers · `1.4M` Orders captured · `<2s` Comment → order · `4.9★` Seller rating.

### 4. Landing — Features (6 cards, 3×2)
Eyebrow "EVERYTHING YOU NEED" + H2 "One toolkit for the whole live sale" (Space Grotesk 44/700).
Each card: 50px rounded icon tile (tinted bg), title (Space Grotesk 19/600), desc (14.5/1.6 `#6A6880`).
Hover: lift + indigo shadow + border `#D9D6F5`.

| Feature | Icon tint | Desc |
|---|---|---|
| 1-Click Print | `#EEF2FF` | Print a receipt the instant an order is captured — thermal & A4. |
| Live Comment Capture | `#FEF2F4` | Auto-detect "mine" comments and turn them into orders in real time. |
| Order Management | `#ECFDF5` | Track every order from reserved to shipped on one clean board. |
| Customer Database | `#EFF6FF` | Every buyer, their history and totals — saved automatically. |
| Bluetooth Printer Support | `#F5F3FF` | Pair any Bluetooth receipt printer and print from your phone. |
| Sales Analytics | `#FFFBEB` | See revenue, top buyers and conversion from every live session. |

### 5. Landing — How it works (dark band `#171530`)
Eyebrow "HOW IT WORKS" (`#A5B4FC`) + H2 "From comment to cash in three steps".
3 steps, each: mono number (`#818CF8`), divider, title (Space Grotesk 21/600 white), desc.
1. **Go live & connect** — link FB/TikTok/IG live in one tap.
2. **Comments become orders** — buyers comment "mine"; capture, reserve stock, create order instantly.
3. **Print & get paid** — one click prints receipt + sends Wise/GCash pay link.

### 6. Landing — Pricing (4 tiers)
Eyebrow "PRICING" + H2 "Simple plans that scale with your lives".
Sub: "Start free with 200 orders per cycle. Pay securely via **Wise + Telegram** — no credit
card needed." Fine print under grid: "Billing in NT$ · Open signup, no admin approval ·
Cancel anytime via Telegram".

Prices in **JetBrains Mono 34/700**. **Every plan CTA links to the create-account page**
(`https://app.sellerflowlive.com/signup`). Pro is highlighted (indigo border + "MOST POPULAR"
badge + lift). Master is a dark `#171530` card.

| Plan | Price | Tagline | Perks | CTA / style |
|---|---|---|---|---|
| **Free** | `NT$0` /forever | 200 orders per cycle | 200 orders / cycle · Live comment capture · 1 connected channel · Telegram support | "Start free", white outline btn, green checks |
| **Basic** | `NT$500` /mo | For solo sellers | Unlimited orders · 1 TikTok or Facebook account · Bluetooth printing · Slip printer support · Customer database | "Choose Basic", dark `#171530` btn |
| **Pro** ⭐ | `NT$1,200` /mo | For growing shops | Everything in Basic · 3 TikTok or Facebook accounts · Auto mode · Sales analytics · Priority Telegram support · Team accounts (3) | "Choose Pro", gradient btn, indigo border |
| **Master** | `NT$1,700` /mo | For high-volume teams | Everything in Pro · 5 TikTok or Facebook accounts · Advanced analytics · Custom receipt branding · Dedicated manager | "Choose Master", white btn on dark card, `#818CF8` checks |

### 7. Landing — FAQ (accordion, max-width 760px)
Eyebrow "FAQ" + H2 "Questions, answered". Each item: white card, question (16/700), `+` toggle
(rotates 45° to ×, `#6366F1`). Single-open accordion. Items:
1. **Do I need a credit card to start?** — No. Bills via Wise + Telegram; Free plan needs no payment.
2. **Can I sign up instantly?** — Yes. Open, instant signup, no admin approval.
3. **Which languages are supported?** — 7 languages (English, Filipino, 中文, Bahasa, Thai, Vietnamese, Japanese).
4. **Does it work with my Bluetooth printer?** — Yes, any Bluetooth thermal/receipt printer, one-tap.
5. **Is there really a free plan?** — Yes; 200 orders/cycle, free forever.

### 8. Landing — CTA band + Footer
- CTA band: full primary gradient `linear-gradient(135deg,#4F46E5,#6366F1 55%,#818CF8)`, radius
  28px, "Ready to sell faster?" + "Start free" (white btn) + "Talk on Telegram" (outline).
- Footer: dark `#171530`, 4 columns (brand + Telegram chip `@SellerFlowLive`, Product,
  Support, Language). Bottom bar: "© 2026 SellerFlowLive…" + "Available in 7 languages · Wise + Telegram billing".

### 9. Dashboard — Login (split screen)
- Left **brand panel** (48%): deep plum radial gradient `radial-gradient(120% 90% at 15% 0%,
  #5b21b6 0%, #3b0d75 45%, #1e0b3e 100%)` with gold/rose glow + faint grid texture. Logo +
  "#1 in PH" gold-star badge; headline "Turn every live into **closed orders.**" (gold gradient
  on "closed orders"); 3 gold-check feature bullets; glass testimonial card (5 stars, Anna Tan,
  12k+ sellers · ₱48M GMV). Gold accent `#E8C98C`.
- Right **form panel**: "Welcome back" (Space Grotesk 32/800). Fields use lavender bg `#F3F2FB`,
  border `#E4E3F3`, radius 16px, 58px tall: "Phone or email" + "Password" (eye toggle).
  "Forgot password?" right-aligned (`#5B4CDB`). Big "Log in" button (`#5B4CDB`, 60px, radius 18px)
  → navigates to dashboard. "New here? Create account". Footer row: "Need help?" (Telegram icon)
  + language selector (globe + 🇺🇸). "By continuing you agree to our Terms".

### 10. Dashboard — App
- **Sidebar** (236px, white): logo, nav (Dashboard active `#F3F0FD`/`#6D28D9`, Live sessions,
  Orders [47], Buyers, Receipts [12], Settings); badges; bottom "Ready to sell?" promo card with
  Go-live button.
- **Top bar** (70px): "Dashboard" + date/live status; search field; bell w/ dot; avatar "M" +
  "Maria S. / Maria's Boutique" (click avatar = logout).
- **Stat row** (4 cards): Today's sales `₱24,580` ▲18% · New orders `47` · Pending receipts `12`
  · Conversion `7.3%`. Mono-ish values, tinted icon tiles, trend chips.
- **Sales chart** (white card, 1.7fr): 7 bars (Mon–Sun), Sat highlighted with indigo gradient;
  Week/Month toggle.
- **Live session panel** (1fr, dark `linear-gradient(160deg,#1e1535,#2a1a52)`): LIVE NOW badge,
  "Summer Drop · Session 3", 128 watching / 9 new orders, "Open live console" / "Go live" toggle.
- **Recent orders table**: columns Buyer · Item · Amount · Channel · Status. Rows have avatar
  initials, status chips (Paid green, To ship amber, Pending rose). Row hover `#FAF9FE`.

---

## Interactions & Behavior
- **Nav links / "See how it works"**: smooth-scroll anchors (`html { scroll-behavior:smooth }`)
  to `#features`, `#pricing`, `#faq`, `#how`.
- **Language switcher**: click toggles a dropdown of 7 languages; selecting one updates the
  current code and closes the menu. (Wire to i18n in the real app.)
- **Pricing CTAs**: all navigate to `https://app.sellerflowlive.com/signup` (create account).
- **FAQ**: single-open accordion; clicking a row toggles it (others close); `+` rotates to ×.
- **Hover**: feature cards lift + shadow; primary buttons brighten + lift 1px; pricing cards lift.
- **Login → dashboard**: "Log in" sets app state to dashboard; avatar click logs out.
- **Live toggle** (dashboard): switches live/offline state across sidebar promo, top bar status,
  and live panel (button label, CTA, gradient).

## State Management
Landing: `lang` (current language code), `langOpen` (dropdown), `faq` (open index, -1 = none).
Dashboard: `screen` ('login' | 'dash'), `email`, `pw`, `showPw`, `live` (bool). Replace with
router + auth + real data fetching in production. Pricing/feature/FAQ data are static arrays —
move to CMS or config as appropriate.

## Assets
- `logo-transparent.png` — SellerFlowLive mark (purple secure-bag "S" with pink live dot).
  Included in this folder. Replace with the official SVG/asset if available.
- All other icons are inline SVG (no icon-font dependency) — re-create with your icon library.
- Flag emoji used for the language switcher.

## Files
- `SellerFlow Landing.dc.html` — landing page (primary deliverable for this handoff).
- `SellerFlow Web Dashboard.dc.html` — login + dashboard reference.
- `logo-transparent.png` — logo asset.
- `support.js` — prototyping runtime only; **do not ship**. Open the `.dc.html` files in a
  browser to view the live reference.
