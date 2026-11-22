# Seller Website (buyer shop) — redesign proposal, Step 0

Proposal and pictures only. No app code changed, nothing merged, no SQL, no server, no deploy.
Branch `claude/serene-fermat-j04cf6`. The flow is untouched: every page, section, step, field and button of
today's shop is in the proposal, in today's order.

- Audit (technical quality): `audit.md` · Critique (design review): `critique.md`
- Today's pages: `before/` · The mock: `after/mock.html` · Its pictures: `after-shots/`
- **Today next to proposed: `compare/`** (36 pictures)
- How the pictures were made: `harness/`

---

## 1. How the skills were used (auditor's rules)

- **Impeccable:** read only. `/audit` and `/critique` were done by hand from its playbooks
  (`reference/audit.md`, `critique.md`, `critique-rubric.md`); the direction follows `new-work-world.md`,
  `distill.md`, `polish.md`, `animate.md`, `typeset.md`, `craft-floor.md`. Its program was not downloaded
  or run, so there is no automatic 62-rule scan, and the "random direction roll" step of the playbook could
  not run. Both reports say which steps were skipped.
- **UI/UX Pro Max:** `search.py` only, printing to the screen, never `--persist`. Looked up: product type
  "e-commerce", styles, palettes, font pairings, checkout rules.
  - What I took: the "Minimalism & Swiss" rules (one accent colour only, no gradients, no shadows unless
    needed), the neutral "E-commerce Luxury" palette idea (near-white paper, near-black ink, one accent), the
    "News Editorial" pairing (Newsreader), and its checklist (no emoji as icons, 4.5:1 text, focus rings,
    reduced motion).
  - What I did **not** take: its automatic design-system answer for a shop was indigo + violet with Inter —
    the generic look this redesign is meant to leave.
- **One slip, fixed:** my first searches made Python leave a `__pycache__` folder inside the skill's
  `scripts/` folder (Python does that by itself). I deleted it. It was never committed.
- `.claude/skills/` and the one `.gitignore` line stay on this branch only. A build branch must not carry them.

---

## 2. What is wrong today (plain words)

Scores, from the two reports: **technical quality 11 of 20** ("acceptable, significant work needed");
**ease of use 28 of 40** ("good", lowest edge). No blocking problem: a buyer can finish an order today.
The flow is sound. The weak part is the look.

| # | Where | What a buyer sees | Evidence |
|---|---|---|---|
| 1 | Home, first screen | A blue-to-purple band with a centred headline in capitals. It is the template, not the seller. Every new website starts with it. | `before/brand-1-home_*_first.jpg`; default set "Ocean" `#1f4fa8` → `#8b5cf6` |
| 2 | Every page | The seller's logo is a 30 px circle. On phone inner pages the shop name is gone. Cover the name and no page tells you whose shop it is. | `v2/Shell.tsx:22` |
| 3 | Cart, checkout, order | Below the top strip the seller's colours vanish: black, white and grey. A selected delivery or payment choice is grey and looks switched off. | `before/brand-4-checkout_*` |
| 4 | Checkout, order | Boxes inside boxes: 5 outer boxes, about 10 inner ones. | `before/brand-4-checkout_laptop1280_full.jpg` |
| 5 | Order page | In the pay box the strongest thing is the "Upload receipt" button. The amount and the account number are ordinary text. "Copy" looks like text. The deadline looks like the flash-sale timer. | `before/brand-5-order_*` |
| 6 | Product cards | Names cut to one line ("Korean Oversiz…") because the sold count shares the line. Prices do not line up from card to card. | `before/brand-1-home_iphone390_full.jpg` |
| 7 | Photos | The same photo is cropped six ways (4:5, 4:3, about 1:1, 1:1, small square, circle). A white label box sits in the middle of the two big tiles. | critique P1 |
| 8 | Icons | Emoji used as icons in 18 places (truck, money, lightning, lock). | audit #12 |
| 9 | Text size | On the home, 156 of 207 pieces of text are under 14 px and 37 under 12 px. One page uses 16–17 different sizes. | `audit-data/measure.json` |
| 10 | Tap size | On the phone home, 62 of 95 things to tap are under 44 px. Hearts 30 px, "+" 34 px. | `audit-data/measure.json` |
| 11 | "Sharp corners" | Only half applied: 12 different corner sizes although the seller chose sharp. | audit #10 |
| 12 | Search on phones | The typing area is 78 px wide at 390 px ("Search in Bu…"). | `before/brand-1-home_iphone390_first.jpg` |
| 13 | Laptop home | A phone page pulled wide: two huge tiles, very long lines, holes in rows. | `before/brand-1-home_laptop1280_full.jpg` |
| 14 | Older "Marketplace" shops | Rounded white cards everywhere on grey, an orange blend banner, and orange text that is too light (3.66:1; needs 4.5). | audit #3 |

**What already works and stays:** no sideways scroll; clear fees, totals and next steps; form fields 16 px
with autofill; product, checkout and order pages already use two columns on a laptop; the colour guard that
keeps text readable whatever the seller picks.

**"AI-made" tells, against Jeff's list:** generic purple — yes (the default band). Same rounded white cards
everywhere — yes on Marketplace shops; on Brand store it is same *outlined boxes* everywhere. Centred hero +
subtitle — yes. Emoji — yes. Fake photos — no (the shop only shows the seller's own photos).

---

## 3. The proposed direction: "Catalogue and slip"

**The idea in three lines.**
Browsing pages (home, shop, product) look like a good mail-order catalogue: the seller's photos in one strict
frame, ruled sections, facts set plainly, prices as strong numerals.
Paying pages (cart, checkout, order page) look like one ruled sheet, like the parcel slip a buyer already
knows from 7-11 pickup: sections divided by lines, not boxes.
The shop's own "paint" is neutral paper and ink. Colour comes only from the seller: the sign at the top, the
buttons, the sale price — and the photos.

Why this and not "luxury minimal": cream page + thin serif is the other generic look. A catalogue and a
parcel slip are things these buyers and sellers handle every week, and they suit clothes, food, gadgets and
beauty equally.

### 3.1 Typography

- **One family per font choice.** A shop asks only for the fonts of its own choice (today the page's font list names four families for every shop).
  | Seller's choice | Today | Proposed |
  |---|---|---|
  | Modern | Space Grotesk + Inter, titles in capitals | **Archivo** (one family: wider for the shop name, narrower for prices) |
  | Friendly | Plus Jakarta Sans | **Bricolage Grotesque** (titles) + **Figtree** (text) |
  | Classic | Fraunces + Inter | **Newsreader** (titles, prices) + **Archivo** (text) |
- **No capitals for titles.** Sentence case everywhere.
- **Fixed size steps:** 12 · 12.5 · 13 · 13.5 · 14 · 15 (body) · 17 · 20 · 25 · 33 on phones. Nothing under
  12 px (today: down to 10.5 px).
- **Prices are their own style:** bold, slightly narrow, same-width digits, small currency sign. They line
  up down a page and across cards.
- **Shop name** is set like a sign: heavy, a little wide (Modern), never shrunk into a chip.
- Chinese, Thai and other scripts use the phone's own font, as today.

### 3.2 Colour rules

1. **Paper and ink are fixed.** Light: paper `#fdfdfc`, ink `#151515`, helper text `#5b5b58`. Dark: paper
   `#111112`, ink `#f1f0ed`, helper `#aaa9a4`. Measured: body text 17.9:1, helper text 6.7:1 (light) and
   8.0:1 (dark).
2. **Top colour 1 = the sign.** A flat bar with the logo, shop name, search and the announcement, on every
   page. No blend. Text on it is picked white or dark automatically (today's guard).
3. **Top colour 2 = a thin stripe** under the sign (3 px). Same colour twice = no stripe.
4. **Button colour** = the main button of each page, the active tab, the chat button, text selection.
   Nowhere else.
5. **Sale colour** = the sale price and the "38% off" tag. The old price is grey and struck through
   (today the red is on the old price).
6. **Green and amber** only say a state: "order placed", "free shipping progress", "waiting for payment".
7. **Selected** = a solid ink outline and a filled dot. Never grey.
8. Nothing else is coloured. No tinted boxes, no shadows except under the two things that float (the "+" on
   a photo and the chat button).

Same seller settings, new result: the `compare/` pictures use today's Ocean set (blue, violet, black, red)
on both sides.

### 3.3 Spacing and structure

- One spacing scale: 4 · 8 · 12 · 16 · 24 · 44 · 72.
- **Sections are divided by one strong line above the title.** No outlined boxes around sections.
- **Lists are ruled rows** (trust facts, how to order, questions, cart lines, delivery and payment choices).
- **The only "box" left** is the promo, drawn as a coupon with a dashed edge.
- Phone: 16 px side margin. Laptop: 48 px, 1184 px wide, home opens as a two-column spread (words left,
  the two tiles right) instead of a stretched phone page.
- Everything to tap is at least 44 px. Measured on the mock: 0 under 44 px on cart, checkout and order
  page; on home only one small text link (today: 62 of 95 under 44 px).
- Corners follow the seller's choice everywhere: sharp = 0, round = 12 px photos / 8 px buttons and fields.

### 3.4 Photo treatment

- **One frame for a shop**, used on tiles, cards, categories, product page, cart thumbnails.
- **Nothing sits on a photo except** one small tag bottom-left (sale / "2 left" / New), the "+" bottom-right
  and the heart top-right. The label box in the middle of the tiles is gone; the name sits under the photo.
- A quiet backing tone behind every photo, so cut-outs, white backgrounds and lifestyle shots sit together.
- Captions under the photo, catalogue style: colours and sold count, name (two lines allowed), one fact
  line, price.
- The product pictures in the mock are **drawn stand-ins** for the seller's own photos. They are not part of
  the design.

### 3.5 Motion (calm; nothing loops)

| Where | What | Time |
|---|---|---|
| Any button | Presses in slightly | 100 ms |
| Size / colour / delivery / payment choice | Outline and dot change | 150 ms |
| Photo in a card (laptop hover) | Photo grows 3% inside its frame; the card does not move | 500 ms |
| Cart panel, size sheet | Slides in; leaves faster than it arrives | 320 ms in, 200 ms out |
| Header | Stays; no change of colour on scroll (it is already solid) | — |
| **Order page (the one authored moment)** | When the status changes ("Payment received", "Shipped"), the new status lands like a stamp: slightly large, then settles | 240 ms |
| Countdown numbers | Do not animate (same-width digits, no jump) | — |

"Reduce motion" on the phone turns all of it off except the colour change. No scroll effects, no fade-in of
every section, no bounce.

### 3.6 Proof it fits any seller

`compare/shops_*`: clothes (Modern, sharp, blue sign), food (Friendly, round, brick sign, square photos),
gadgets (Modern, dark page, black sign, lime buttons), beauty (Classic, round, pale sign with dark text).
Four different shops, one system, no extra setting except photo shape (see decision 4).

---

## 4. Decisions for Jeff

1. **Two top colours.** Today they blend. Proposed: colour 1 is the sign, colour 2 is the stripe. The
   seller's Website editor shows two small blend previews; those two chips would have to show "sign +
   stripe" instead (one seller-side file, look only).
2. **What a new website starts with.** Today: Ocean (blue to violet). Proposed: a neutral start (ink sign,
   ink button) so the seller's logo and photos lead until they pick a colour. Only for websites started
   after the change.
3. **New typefaces for the three font choices** (table in 3.1). The seller's setting does not change; what
   "Modern / Friendly / Classic" look like does.
4. **Photo shape.** Clothes sellers shoot tall; food and gadget sellers shoot square. Either (a) one tall
   frame for everyone, with square photos shown whole on the backing tone, or (b) a new seller setting
   "Photo shape: tall / square". (b) looks best but is a new setting plus a database whitelist line — it is
   **not** "styles only". The food and gadget pictures use square to show (b).
5. **Search on inner phone pages.** To fit the shop name next to the logo on product, cart, checkout and
   order page, search shows as an icon there and opens the same search. On home and shop it stays a full
   field. If you prefer today's field on every page, the name stays hidden on inner phone pages as today.
6. **Existing shops.** Any redesign changes how every live shop looks on the day it ships. Do you want it
   behind a switch first (test shops only), as with other features?
7. **Marketplace layout** (older shops) is not pictured. The same rules would apply; its home has other
   sections (carousel, ranked best sellers, flash-sale row) that need their own pictures before a build.

---

## 5. Files a build would touch

**Would change — look only:**

| File | What changes |
|---|---|
| `src/website/shopStyle.ts`, `v2/styles.ts`, `v3/styles.ts` | The shop's CSS |
| `src/website/v3/look.ts` | Only how saved settings become colours, fonts and corners (`lookStyle`, `LOOK_FONTS`; `NEW_SHOP_LOOK` if decision 2 is yes). The saved settings, their checks and the colour guard stay. |
| `src/website/v2/theme.ts` | Colours of the three older themes |
| `src/website/ui.tsx`, `v2/Shell.tsx`, `v2/Card.tsx`, `v2/icons.tsx`, `v3/BrandCard.tsx`, `v3/BrandHome.tsx`, `v3/QuickSheets.tsx` | Markup and inline styles of the header, cards, home, panels |
| `src/website/pages/Home.tsx`, `Product.tsx`, `ShopList.tsx`, `Cart.tsx`, `DevicePages.tsx` | Markup and inline styles of the pages |
| `src/website/checkoutPages.tsx` | The checkout and order SCREENS: how they are drawn. Every field, step, button, `data-testid` and every function they call stays. |
| `shop.html`, `ShopApp.tsx` (the font link only) | Which font files load |
| `src/redesign/components/WebsiteLookEditor.tsx` | Only if decision 1 is yes: the two blend preview chips |
| Tests that pin the old look | 11 files under `src/website/__tests__/` (`v2.item3`, `v2.item6`, `v3.item1`–`8`, `v3.cartIcon`) and `websiteSeller.part4.test.tsx` refer to the style code; the ones that pin old colours, fonts or "looks the same as before" would be rewritten for the new look. Tests of cart, checkout, pricing and orders are not touched. |

**Would not change — 0 lines:**

- Cart, checkout, payment, order, pricing, shipping logic: `cart.ts`, `checkoutLogic.ts`, `orderApi.ts`,
  `orderText.ts`, `pricing.ts`, `shipPay.ts`, `addressForm.ts`, `saved.ts`, `shopApi.ts`, `shopLogic.ts`,
  `shopFilter.ts`, `shopLinks.ts`, `route.ts`, `og.ts`, `pages/homeData.ts`, `pages/productData.ts`,
  `v2/cardFacts.ts`, `v3/brandData.ts`, `v3/brandBadge.ts`, `v3/quickAdd.ts`.
- The seller's Website editor (except the two chips above), Payment & shipping, Website orders, Products.
- Database (`sql/**`), server (`server.js`, `server/**`, `api/**`), printing, Chrome extension, phone apps.

Only decision 4(b) would add a setting and one database whitelist line. Without it: **no database, no
server**.

---

## 6. Not design — for Jeff to know (found by the audit, not part of this proposal)

1. **Checkout on a phone: a missing field shows nothing on screen** after "Place order" (the two error
   messages are off screen and the page does not move). `checkoutPages.tsx:114, :144, :234`;
   `audit-data/checkout-error_iphone390.png`.
2. **The red "LIVE" tag cannot be read today** (grey on red, 1.05:1). One style rule beats another:
   `v2/styles.ts:61` over `:58`.
3. **The buyer downloads 517 KB of program before the shop shows**; 412 KB of it is the seller app's texts
   in 8 languages, of which the shop uses 257. `ShopApp.tsx:8, :67`.
4. **The cart panel and size sheet ignore the keyboard** (focus stays behind, Escape closes nothing).
5. The page always declares Traditional Chinese (`shop.html:2`); "see policy" does not open from the
   keyboard (`Product.tsx:127`).

---

## 7. Limits of this proposal

- The mock is separate HTML, not the app. It shows the look, not behaviour. Links between its pages work;
  buttons do nothing.
- Product pictures are drawn stand-ins. The chat and social marks are plain coloured squares in the mock;
  the real shop keeps the official marks it uses today.
- Pictured: Brand store layout in light mode for all five pages; dark mode for a home and a product page.
  **Not pictured:** dark cart / checkout / order page, the Marketplace layout, the shop list, saved,
  my orders, the size sheet and cart panel, error and empty states, languages other than English.
- Looked at in one test browser at phone and laptop sizes. No real iPhone or Android phone.
- Font file sizes (Latin part): Archivo 90 KB, Bricolage Grotesque 77 KB, Figtree 20 KB, Newsreader 132 KB.
  A shop would load one choice, not all.
