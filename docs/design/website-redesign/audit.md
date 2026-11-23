# Seller Website (buyer side) — technical audit of today's pages

Step 2 of the redesign proposal. Read and measure only: no file of the app was changed.
Branch `claude/serene-fermat-j04cf6`. Date: 2026-11-22.

**What was looked at.** Home, product, cart, checkout and order page, in the Brand store layout with the
Ocean colours (what a new website gets today), plus the older Marketplace home. Demo shop "Budgetukay",
demo data only, placeholder buyer "Demo Buyer / 0900 000 000".

**How.** The Impeccable "audit" playbook, followed by hand (its program is not installed — see section 4).
Three sources of evidence:

- the code in `src/website/` and `shop.html` (file:line in the table);
- the pictures in `before/`;
- numbers measured on the real pages in a test browser at 320, 390 and 1280 px wide:
  `audit-data/measure.json` and `audit-data/extra.json`, made by `harness/audit-measure.cjs` and
  `harness/audit-extra.cjs`. Four close-up pictures are in `audit-data/` too.

Contrast numbers use the standard formula (WCAG). The pass marks are 4.5 to 1 for normal text and 3 to 1 for
big text. "Tap target" = the size of the thing a finger has to hit; 44 px is the comfortable size, 24 px is
the legal minimum in the standard.

---

## 1. Scores

Each area is scored 0 to 4, as the playbook asks.

| # | Area | Score | Main reason |
|---|------|-------|-------------|
| 1 | Accessibility | **2 / 4** | Buttons are named well, but some text cannot be read, no page has a main heading, pop-up panels ignore the keyboard, and a checkout error can be off the screen. |
| 2 | Performance | **2 / 4** | Pages are light and pictures load late, but the buyer downloads 517 KB of program (compressed) before anything shows, and four-fifths of it is text the shop never uses. |
| 3 | Theming | **2 / 4** | There is a real set of shared colours and a contrast guard, but 185 colours are typed straight into the pages, and corners, fonts and the dark looks do not follow the seller's choice everywhere. |
| 4 | Responsive | **3 / 4** (low end) | No sideways scroll at 320, 390 or 1280 px and the layouts adapt well. But 62 of 95 things to tap on the phone home are smaller than 44 px, and the search box almost disappears on small phones. |
| 5 | Anti-patterns (the playbook calls it "implementation integrity") | **2 / 4** | Blue-to-purple gradient as the default, emoji used as icons, boxes inside boxes, 17 text sizes on one page, leftovers of two earlier designs layered on top of each other. |
| | **Total** | **11 / 20** | "Acceptable — significant work needed" on the playbook's scale. |

**Verdict on area 5 (the playbook asks for pass or fail): fail, but not badly.** The pages work and look
tidy. They do not yet look like one designed system: three generations of styling sit on top of each other
(the first shop, "v2", "v3"), and v3 fixes v2 with overrides instead of replacing it.

**Count of findings:** P0 (blocks the buyer) 0 · P1 (serious) 6 · P2 (annoying) 15 · P3 (polish) 4.

No P0: with a finger, every page can be used to the end.

---

## 2. Findings

P0 = blocks the buyer · P1 = serious, or fails the accessibility standard · P2 = annoying, has a way around ·
P3 = polish. "Look" = a new design fixes it. "Code" = a new look alone does not fix it (see section 5).

| # | Sev. | Page(s) | What is wrong | Evidence | What a redesign should do |
|---|------|---------|---------------|----------|---------------------------|
| 1 | P1 | Checkout (phone) | Tap "Place order" with a field missing: nothing changes on the screen. The red field is above, the message "fix the marked fields" is below, both off the screen. The buyer thinks the button is broken. | Measured: 2 error messages on the page, 0 on the screen; the page did not move. Picture `audit-data/checkout-error_iphone390.png`. `checkoutPages.tsx:114`, `:144`, `:234` (the message lives in the summary box at the very bottom). | Look: show the message right above the "Place order" bar, where the finger is. Code: also bring the first wrong field onto the screen. |
| 2 | P1 | Home (both layouts) | The red "LIVE" tag cannot be read: grey letters on red. | 1.05 to 1 (needs 4.5). Dark looks: 1.75 to 1. Picture `audit-data/live-pill_iphone390.png`. Cause: the rule in `v2/styles.ts:61` (grey for the small text) wins over `:58` (white for the tag). | White letters on the red (4.7 to 1). One line. |
| 3 | P1 | Marketplace layout, all pages | The orange of the older "Pop" theme is too light for text: prices, links, button labels, badges. | `#ee4d2d` with white = 3.66 to 1. On the home: 62 pieces of text fail (20 prices at 15.5 px, 42 labels on orange down to 10.5 px). "See all" on the grey page = 3.36. `v2/styles.ts:7`, `v2/theme.ts:12`. The contrast guard (`v3/look.ts`) only protects shops that have a look. | Every colour set must pass for text before it is offered. Use the brand colour for big things; write prices in the text colour. |
| 4 | P1 | Every page (first visit) | The buyer's phone downloads 1.74 MB of program (517 KB compressed) before the shop shows. 412 KB of that is one file holding the seller app's 3,061 texts in 8 languages; the shop uses 257 of them. Meanwhile the screen is an empty grey page. | Built once into a scratch folder to measure (not into the repo). `ShopApp.tsx:8` imports `src/redesign/i18n` (1.26 MB of source). Empty grey page: `ShopApp.tsx:67`. Browser tab says "Shop": `shop.html:9`. | Code: give the shop its own small text file. Look: draw the page frame (header, grey picture boxes) while loading instead of a blank page. |
| 5 | P1 | Cart panel, size sheet, chat sheet, info sheets | The pop-up panels are not real pop-ups for a keyboard or a screen reader. The cursor stays on the page behind, the Tab key never enters the panel, Escape does not close it, the page behind still scrolls. | Measured on the cart panel: focus stayed on the cart button; 0 of 14 Tab presses landed inside; Escape closed nothing. `v3/QuickSheets.tsx:43`, `v2/Shell.tsx:165`. | Code: move focus in, keep it in, close on Escape, lock the page behind. Look: give every panel a clear close button at the top (the cart panel has one; the sheets only have "Close" at the bottom). |
| 6 | P1 | All pages | Many things to tap are small. Some are under the 24 px minimum. | Phone home: 62 of 95 under 44 px; 9 under 24 px. Smallest: "See all" 41×16, language picker 116×16, question rows 19 tall, "Home ›" trail 34×17, "Size guide" 161×18, "see policy" 57×15. Others: heart 30×30, quick-add "+" 34×34 (30×30 in Marketplace), header icons 36×36, quantity − / + 36×36, "Remove" 46×28, buy-bar buttons 42 tall. `v2/styles.ts:21, :81, :98, :181`, `v3/styles.ts:68`. | One rule: nothing a finger taps is under 44×44, text links included (grow the tap area, not the text). |
| 7 | P2 | All pages | Text is small. Most of it is under 14 px, and a good part under 12 px. | Brand home: 156 of 207 pieces of text under 14 px, 37 under 12 px. Marketplace home: 96 of 239 under 12 px. Smallest: 10 px (cart count), 10.5 px (badges, bottom-bar labels). Base size 14 px: `v2/styles.ts:6`. | Body text 15–16 px on phones, nothing under 12 px. |
| 8 | P2 | All pages | No page has a main heading, and the page parts are not marked. A screen reader user cannot jump to "the product" or "the menu". | No visible top-level heading on any page. Home starts at level 2. Cart has no page heading. Checkout's heading is hidden so well that screen readers skip it too (`checkoutPages.tsx:138`, class `v-hide` = removed). Product name is level 2 (`Product.tsx:75`). The top bar is not marked as a header; the laptop category row is not marked as a menu (`Shell.tsx:58-72`). No "skip to content" link: 14 Tab presses before the content on laptop. | One main heading per page (shop name, product name, "Cart", "Checkout", "Order W-…"). Mark header, menu, main, footer. |
| 9 | P2 | All pages (keyboard) | Too many Tab stops, some with no name; the search box shows no focus ring; one link cannot be opened by keyboard. | Brand home: 119 Tab stops; 18 are picture strips with no name; each product card is 4 stops. Search: `outline:0` and nothing in its place (`v2/styles.ts:20`). "see policy" on the product page did not open with Enter or Space (`Product.tsx:127`). No focus style of our own anywhere — only the browser's thin default ring. | A clear focus ring in the shop's colour on everything. One Tab stop per card plus its buttons. |
| 10 | P2 | All pages | The page always tells the browser it is in Traditional Chinese, whatever language the shop shows. | `shop.html:2` says `zh-Hant`; nothing in `src/website` ever changes it. An English or Filipino shop is read out with a Chinese voice, and browsers offer to "translate" it. The tab title is the shop name on every page. | Code: set the page language from the shop's language. Title per page ("Vintage Sport Tee — Budgetukay"). |
| 11 | P2 | All pages | Buttons do not react. No pressed look, almost no hover look, no loading look. | In 38.6 KB of shop styles: 6 hover rules, 0 pressed rules, 0 focus rules. Loading the shop = blank grey; loading an order = "…" (`checkoutPages.tsx:289`). | Design the states: pressed, hover, focus, busy, disabled, empty. |
| 12 | P2 | Home (phone) | The search box nearly disappears on small phones, because the shop name sits beside it. | Typing area: 8 px wide at 320 px, 48 px at 360 px, 78 px at 390 px (the hint is cut to "Search in Bu"). `v2/styles.ts:19`, `Shell.tsx:62-65`. Picture `before/brand-1-home_iphone390_first.jpg`. | On phones: a search icon that opens a full-width search, or a search row of its own under the name. |
| 13 | P2 | Home, shop list (phone) | The green chat button floats over the content and covers links. The bottom bar already has "Chat", so there are two. | 50×50 px, fixed. 14 controls pass under it while scrolling the home, among them every "See all" (picture `before/brand-1-home_iphone390_first.jpg`). Its white icon on green `#06c755` = 2.26 to 1. `v2/styles.ts:147`, `ShopApp.tsx:180-181`. | One chat entry on phones (the bottom bar). Keep the floating button for laptop only, or drop it. |
| 14 | P2 | Product, cart, checkout (Ocean) | "Selected" and "notice" look switched off. The tint is 10% of the button colour; Ocean's button is black, so the tint is plain grey. | Tint `#e7e7e7`. Used for the chosen delivery and payment, the flash-sale strip, the free-shipping strip. Small grey text on it = 3.98 to 1 (fails). `v3/look.ts:122`. Pictures `before/brand-4-checkout_*`, `brand-2-product_*`, `brand-3-cart_*`. | Selected = a clear mark plus a border in the text colour, not a grey fill. Notices get their own colours (sale, good news, warning). |
| 15 | P2 | Checkout, cart, order (Ocean) | Corners do not follow the seller's choice. Ocean is "sharp", yet inputs, choice rows, quantity boxes and thumbnails are rounded and pills are fully round. | 12 different corner sizes in use (0, 3, 4, 5, 8, 9, 10, 11, 12, 16, 18, fully round). Fixed values: `v2/styles.ts:180, :202, :203`, `Cart.tsx:53`, `checkoutPages.tsx:133, :160`. Picture `before/brand-4-checkout_laptop1280_first.jpg` (square boxes, round fields inside). | Two or three corner sizes, all driven by the one setting. |
| 16 | P2 | All pages | No clear scale of text sizes, and fonts are not fully under the look's control. | 16–17 different sizes on one page, in half-pixel steps (10.5, 11.5, 12.5, 13.5, 14.5, 15.5). "Inter" is typed into 13 rules (badges, counters), so a "friendly" shop still downloads Inter for them (measured: the Marketplace home loaded two font files). No Chinese font is named: Chinese text uses the phone's own font next to Space Grotesk, and the "ALL CAPS" headings do nothing for Chinese. | Five or six sizes with clear steps. Every text uses the look's fonts. Decide how Chinese headings should look. |
| 17 | P2 | Checkout, order (dark looks) | Colours typed into the pages ignore the look. The dark looks show it. | 185 colour codes inside the page files; `checkoutPages.tsx` alone has 123 hand-styled elements. Helper grey `#6B7280` (`shopStyle.ts:35`) on a dark card = 3.56 to 1, 8 pieces each on checkout and order (Midnight look and Bold theme). Status tag and the green tick keep light-theme colours (`checkoutPages.tsx:310, :317`; picture `audit-data/dark-midnight-look-order_iphone390.png`). Order link text `#374151` on the Bold theme = 1.86 to 1 (`:407`); for looks it is patched by a forced override (`v3/styles.ts:12`). The guard works by matching the text of hand-written styles (`v3/styles.ts:9`) — it breaks silently if a style is written differently. | Every colour comes from the shared set, including good / warning / error and their soft backgrounds. No colour typed into a page. |
| 18 | P2 | Home, product | Full-size photos are used where small ones would do, and the product page loads every photo at once. | A full photo can be 2048 px and up to 1 MB (upload rule). Used full size for: the 2 band tiles and up to 8 category tiles (`v3/BrandHome.tsx:57, :86`), the 68 px category circles (`pages/Home.tsx:59`), the 54–58 px product thumbnails (`Product.tsx:70`). Product page: all gallery photos load at once (`Product.tsx:65`). No picture offers a choice of sizes (0 of 63). | Use the small copy for tiles, circles and thumbnails. Load gallery photo 2, 3… when the buyer swipes. |
| 19 | P2 | Home, product, checkout | Other text and marks that are too faint. | "Verified seller" green `#16a34a` = 3.3 to 1 at 11.5 px. "Free" in the same green = 3.3. "Only 2 left" amber `#d97706` = 3.19 (`Product.tsx:103`). Search hint on the band, laptop: about 3.3 (colour sampled from the picture). Field borders `#e6e7ec` on white = 1.23 to 1, so boxes are hard to see (the standard asks 3 to 1). Brand cards: the heart has no backing (`v3/styles.ts:52`), so a dark heart sits on any photo. | Darker green and amber for text. Visible field borders. A backing behind the heart. |
| 20 | P2 | Home, cart, checkout, product | Emoji are used as icons. | 18 places: 🚚 💵 ✓ ⚡ in the Brand trust line (`v3/BrandHome.tsx:66`), 🎉 🔒 🗺 ♡ ♥ ● elsewhere. The Marketplace layout draws real icons for the same four facts (`pages/Home.tsx:49`). Emoji look different on every phone and cannot take the shop's colour. | One drawn icon set, one line weight, everywhere. |
| 21 | P2 | Home, checkout, order | Signs of a template, as the playbook lists them. | (a) The default band is a blue-to-purple gradient (`v3/look.ts:19`) with Space Grotesk + Inter in capitals — the most common "made by a tool" look. (b) Marketplace: orange gradient banner, 4 same-size icon cards, 3 numbered step cards. (c) Boxes inside boxes on checkout and order (a bordered box holding bordered rows). (d) The first screen shows no product, on phone and laptop: band + two big tiles fill it (`before/brand-1-home_*_first.jpg`). (e) Laptop rows leave holes: 4 cards in a 5-wide row, 7 tiles in 8 places (`before/brand-1-home_laptop1280_full.jpg`). (f) The order page says the 24-hour rule twice, one line apart (`before/brand-5-order_*`). | A first screen that shows goods. Flat sections with space instead of boxes in boxes. A default look that does not read as a template. |
| 22 | P3 | Checkout, product, cart | Small form gaps for screen readers. | The note box has no name (`checkoutPages.tsx:212`). Errors are not tied to their field. The delivery and payment groups have no name and do not answer the arrow keys. Quantity buttons are read as "minus" / "plus" only; thumbnails as "1, 2, 3"; the row's left arrow is called "Back". | Name every field and group; say "one more / one less of <product>". |
| 23 | P3 | All pages | Motion: there is almost none, and the "less motion" setting is only half respected. | One 0.2 s fade on the header (`v3/styles.ts:20`). The rule for "reduce motion" (`v2/styles.ts:257`) only covers scrolling done by styles; the two scripted smooth scrolls still glide (`Product.tsx:47`, `v3/BrandHome.tsx:144`). | If motion is added, plan the "reduced" version with it. |
| 24 | P3 | All pages | Leftovers from earlier designs still travel to the buyer. | 10 style names no page uses (vouchers, reviews, stars…). The laptop block of styles is sent twice (`v2/styles.ts:303-304`). Five old page parts in `ui.tsx` are used nowhere. The first shop's styles (`shopStyle.ts`) are still sent. All 38.6 KB of styles ride inside the program and are put on the page by it (`ShopApp.tsx:171`). | Start the new look from one clean style file. |
| 25 | P3 | All pages | Small theme misses. | The browser's top bar is always white (`shop.html:7`), even over the blue band or a dark shop. The page is grey before it loads, then white in the Brand store (a flash). The toast is told both to wrap and not to wrap (`v2/styles.ts:232`): a long sentence can run off a phone. All sizes are in fixed pixels, so the phone's "bigger text" setting changes nothing (zoom still works). | Small fixes to carry into the new style file. |

### Repeating causes (the playbook's "patterns")

1. **Sizes were tuned for a mock-up, not for fingers and eyes.** Small text (finding 7) and small tap
   targets (6) are the same habit. One size scale and one "44 px" rule remove about 100 single problems.
2. **The look's settings are not the single source.** Colours (17), corners (15), fonts (16) and the grey
   "selected" tint (14) all leak around the seller's choice.
3. **Layers instead of one system.** v3 corrects v2 with overrides (17, 24). Every new look multiplies the
   places to patch.
4. **States were not designed.** Pressed, focus, busy, loading, error-on-screen (1, 9, 11).

---

## 3. What already works — keep

- **No sideways scroll** at 320, 390 and 1280 px on all six pages (measured). 320 px is the same as a
  laptop zoomed to 400%.
- **The layout follows the shop's own width**, so the editor preview and the real shop match.
- **The contrast guard** for looks: white on the Ocean band measures 4.2 to 7.7; an unreadable button or
  sale colour is swapped. Keep the idea, extend it to every colour.
- **Icon buttons have names** for screen readers (cart, saved, back, heart, quick add): 0 buttons without a
  name on the pages measured. Hearts and option buttons say "on / off".
- **Sold-out sizes** are crossed out and switched off — not shown by colour alone. Colours carry their name.
- **Form fields are 16 px**, so iPhones do not zoom in; name, phone and address fields offer autofill.
- **Bottom bars respect the iPhone home bar**; totals and the main button stay in reach.
- **Chat and map buttons are real links**, so they open on iPhone.
- **List pictures use the small copy and load late**; picture boxes keep their shape, so nothing jumps.
- **Pages are light**: 611 elements on the home, almost no animation, the banner never moves by itself.
- **Only two font files are downloaded** for an Ocean shop (about 70 KB), although four families are listed.
- **Honest content**: real sold counts, no fake ratings, the price and delivery cost shown before buying.

---

## 4. Playbook steps skipped, and why

The playbook's launcher program (`scripts/impeccable …`) is not installed and was not run or downloaded.

| Step in the playbook | What was done instead |
|---|---|
| "Run the bundled detector" (area 5) | Skipped. The tells were checked by reading the code and the pictures (findings 20, 21, 24). No automatic 62-rule scan. |
| Screenshot command (`impeccable shot`) | Skipped. Used the pictures in `before/` and four close-ups taken by the audit scripts. |
| "Save the report" (`impeccable audit-storage write`) | Skipped. The report is this file. |
| Live / desktop-app scan | Skipped. Not a desktop app. |
| Loading PRODUCT.md / DESIGN.md through the launcher | Skipped. Neither file exists in the repo. |
| Right-to-left checks | Not needed: none of the shop's 8 languages is written right to left. |
| "Suggested command" per finding and the closing prompt | Left out: those commands need the launcher, and this step is a report only. |

Also not run: anything in `.claude/skills/` (no script, no Python). No install, no download, no new server,
no commit.

---

## 5. Not design — for Jeff to know

A new look does not fix these by itself. Nothing here was designed around.

1. **Checkout error off the screen (finding 1).** The look can move the message. Bringing the wrong field
   onto the screen is a change in how the page behaves.
2. **Program size (finding 4).** The shop loads the seller app's whole text table. This is build set-up,
   not look. It is the biggest single win for buyers on mobile data.
3. **Pop-up panels and the keyboard (finding 5).** Focus, Escape and locking the page behind are behaviour.
4. **"see policy" does not open from the keyboard (finding 9).** A one-line fix (`Product.tsx:127`).
5. **Page language always "Chinese" (finding 10).** One line when the shop loads.
6. **Old photos have no small copy.** The small-picture rule only matches newer file names
   (`shopApi.ts:120`); older photos are shown full size in lists. With the demo photos this is what happens
   in the cart (74 px box, full photo).
7. No bug was found in how the cart, checkout, payment or orders work. They were not tested beyond the one
   checkout tap in finding 1.

---

## 6. What could not be checked

- **Real phones.** Everything was measured in one test browser (Chromium) set to phone sizes. No real
  iPhone Safari, no real Android.
- **A real screen reader.** Names, headings and focus were read from the page; nothing was listened to.
- **Swiping.** The picture strips use the browser's own scrolling (read in the code); the gesture itself
  was not tried with a finger.
- **Real photos and a real network.** The demo uses drawings, so picture weight comes from the upload rules,
  not from a measurement. Loading time on a phone network was not measured; only file sizes.
- **Other looks and languages.** Measured: Ocean, the Pop theme, and contrast only for Midnight and Bold.
  Not measured: Blush, Forest, Sunset, Boutique, and long text in Thai, Bulgarian or Chinese.
- **Other pages.** Shop list, saved, my orders, pick a store, and the "order sent" moment were read in the
  code, not measured.
- **The automatic detector** (section 4).
