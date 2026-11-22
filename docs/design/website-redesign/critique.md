# Seller Website — design critique of today's pages

Step 2 of the design-only proposal. Nothing in the app was changed. This file only reports.

**DEGRADED: single-context (delegated read-only run, no detector program).**
The Impeccable "critique" playbook asks for two separate reviewers and an automatic detector.
Here one reviewer did the whole thing by hand. What was skipped, and why:

- The launcher program (`scripts/impeccable`), its `detect` scan, the `live-server` overlay and the
  `critique-storage` snapshot were **not run**. They are not installed and must not be downloaded.
- So there is no automatic rule scan and no saved snapshot. Every finding below comes from looking at
  the pictures and reading the shop's style code.
- Questions skipped: delegated run. The owner's questions are at the end as plain points to think about.

What was looked at: all 18 first-screen pictures in `before/`, the laptop full pages, and the phone
full pages cut into readable pieces (`crops/`, made by `harness/crit-crops.cjs`, which only reads a
picture and writes pieces of it). Code read: `src/website/v3/look.ts`, `v3/styles.ts`, `v2/styles.ts`,
`v2/Shell.tsx`, parts of `v3/BrandHome.tsx`, `pages/Product.tsx`, `checkoutPages.tsx`.

The product drawings in the pictures are test placeholders. They are not judged. How photos are
framed, cropped and surrounded is judged.

---

## 1. Scores

### Ease of use (Nielsen's 10 points, 0 to 4 each)

| # | Point | Score | Main reason |
|---|---|---|---|
| 1 | The buyer can see what is happening | 3 | Steps "1 Cart, 2 Details, 3 Done", cart count, free-shipping bar, order timeline are all there. The step line is tiny (12px) and the LIVE label cannot be read. |
| 2 | Speaks the buyer's language | 3 | Plain words, local stores, the Chinese term next to "Pay at pickup". |
| 3 | The buyer can go back or undo | 3 | Back arrow, Remove, Change store, "Not you?", Back to shop. |
| 4 | Same things look the same | 2 | Corners, photo shapes, boxes, buttons and icons change from place to place. Details in the issues list. |
| 5 | Stops mistakes before they happen | 3 | Choices are pre-picked, sold-out sizes are crossed out, stock is shown, the account number has a Copy. |
| 6 | Nothing to remember | 3 | The order summary is repeated at checkout and on the order page. The order link is kept on the page. |
| 7 | Fast paths for regular buyers | 3 | Quick add "+", Buy now, details filled in from the device. |
| 8 | Clean look, nothing extra | 2 | The content is clear, but boxes are everywhere, three things sit on every photo, six loud titles, a floating chat button on top of a Chat tab. |
| 9 | Helps when something goes wrong | 3 | Read from the code only (no picture of a mistake): each field has its own plain message next to it. |
| 10 | Help is easy to find | 3 | How to order, Good to know, returns on the product page, chat on every page. |
| | **Total** | **28 / 40** | **Good (lowest edge of "Good")** |

What this number means: the shop is **easy to use**. The flow is sound. The two low scores (4 and 8)
are both about the **look**. That matches the owner's feeling: the problem is not how it works, it is
how it looks.

### How much the buyer has to think (8 checks)

2 of 8 fail. That is "moderate".

- **Fails: one clear focus (home).** On the phone's first screen the band, two big tiles, four trust
  lines, the search box and a green chat button all ask for attention. The first product photo is cut
  off at the bottom edge.
- **Fails: clear order of importance (order page, product cards).** On the pay box the black button is
  the strongest thing. The amount and the account number are ordinary text.
- Passes: grouping, small groups, one decision at a time, nothing to remember, details shown only
  when needed.
- More than 4 choices in one place: the laptop menu row has 9 links, the phone bottom bar has 5. Both
  are normal for a shop. No change needed.

### The look, page by page (plain verdict, not a number from the playbook)

| Page | Does it look like this seller's shop? |
|---|---|
| Brand home | No. The first screen is the template's blue-to-purple band. |
| Brand product | Neutral. Clean, but it could be any shop. No seller colour at all below the thin top strip. |
| Brand cart | Neutral. Plain boxes. |
| Brand checkout | Neutral, and heavy: boxes inside boxes. |
| Brand order page | Neutral. Works, but the payment part does not feel careful enough for sending money. |
| Marketplace home | No. It looks like a copy of a big marketplace app: rounded white cards on grey, orange everywhere. |

---

## 2. Does it look made for this seller? (the playbook's first question)

**No. It looks like a template with the seller's name typed in.**

Cover the name "Budgetukay" and nothing on any page tells you whose shop it is. The reasons:

1. **The seller's logo is a 30px circle.** The code forces every logo into a small circle and crops it
   (`Shell.tsx`, 30 by 30, round, cropped to fill). A wide logo with words in it is cut. On laptop it
   is still 30px. On phone inner pages the shop name next to it is dropped, so the shop's whole
   identity is one small circle.
2. **The seller's colours live in one place.** The two "top colours" paint the band on the home page
   and the thin strip at the very top. Below that the page is white, black and grey. On product, cart,
   checkout and order pages the only seller colour is that thin strip.
3. **The default look is the generic one.** A new shop starts with "Ocean": blue `#1f4fa8` blending
   into purple `#8b5cf6`, black buttons, capital-letter titles. This is exactly the "generic purple"
   on the owner's list. Most sellers will never change it.
4. **With black buttons, every "tint" turns grey.** Notes, the free-shipping bar and the selected
   delivery choice take a pale version of the button colour. Black makes that grey. So the default
   shop has no colour at all in its working parts.
5. **The seller's photos are treated roughly.** They are cropped into six different shapes, and labels and
   buttons sit on top of them. See issue 5.

The structure is the standard shop page: headline in the middle, sub-line under it, rows of the same
card, boxes of the same shape. Any product type and any seller would get the same page.

---

## 3. What works (keep these)

1. **The buying controls are in the right place on a phone.** "Add to cart / Buy now", "Checkout" and
   "Place order" stay at the bottom of the screen with the total next to them. One thumb reaches them.
2. **The Brand store's product cards are close to right.** No border, no shadow, sharp edges, the photo
   is the card. This is the least "template" part of the site and the best base for the new look.
3. **The checkout is honest and complete.** Fees are shown per delivery choice, the total updates, the
   summary shows photos of what is being bought, and a line says what happens after the order.
4. **The order page tells the buyer where they are.** Timeline, status, the bank details, a deadline,
   a link to come back. Everything a buyer needs after paying is on one page.
5. **The colour safety check already exists.** `look.ts` makes sure text stays readable on any colour
   the seller picks. A new look can lean on it and use the seller's colour in more places safely.
6. **Laptop product, checkout and order pages use two columns well.** Photo or form on the left,
   summary and the main button on the right.

---

## 4. Priority issues

Severity: P0 = stops a buyer. P1 = hurts trust or causes real confusion. P2 = annoying, has a
workaround. P3 = polish. **There is no P0.** Every direction below changes only the look. No step,
field, section or button is added, removed or moved.

| # | Sev | Page | What | Why it matters to a buyer | Direction |
|---|---|---|---|---|---|
| 1 | P1 | Brand home | The first screen is a blue-to-purple blended band with a centred, all-capitals headline and a centred sub-line. It is the default for every new shop. | The buyer comes from a live or a chat and expects that seller. The first thing they see is the template. It looks like a generic or machine-made page, which lowers trust before a single product is seen. | One flat seller colour, or the seller's own photo, at the top. No two-colour blend by default. Headline in normal letters, set to one side. A new shop should start from a calm neutral, not from purple. |
| 2 | P1 | All pages | The seller's logo is forced into a 30px circle and cropped. On phone inner pages the shop name is dropped. | The logo is the one thing the buyer knows from the live. If it is tiny or cut, the buyer cannot be sure it is the same seller, least of all on the pages where they pay. | Give the logo more room and keep its own shape (wide logos stay wide, no forced circle). Make it large enough to read on every page. |
| 3 | P1 | Product, cart, checkout, order | Below the top strip the seller's colours disappear. The default shop is black, white and grey. | Inner pages look unfinished and anonymous. The seller chose colours and the buyer never sees them where it counts. | Carry one seller colour through in small, exact places: the selected choice, links, the current step, the progress bar, the sale price. Take the pale tints from the seller's top colour, not from a black button. Keep the existing readability check. |
| 4 | P1 | Home, product, cart (product cards) | Product names are cut to one line because "212 sold" shares the line: "Korean Oversiz…", "Vintage Sport T…". In the laptop cart's "Goes well with" row names are cut to one word: "Y2K…", "Washed…". Colour squares sit above the name on some cards only, so names and prices do not line up along a row. | The buyer cannot read what the item is. Longer names (food, gadgets with model numbers) will be worse. Uneven rows look careless. | Name on up to two lines with the full width. "Sold" count on its own small line. The same order of lines on every card so prices line up. |
| 5 | P1 | Home, product, cart | The same photo is cropped into six shapes: tall tile (4:5), wide tile on laptop (4:3), card (about 1:1.1), product page (1:1), small rounded square in the cart, and a circle in the Marketplace layout. On the two big home tiles a white label box sits in the middle of the photo. Each card photo also carries a tag, a round "+" and a heart. | Sellers' photos come from phones and live screenshots. Cropping cuts off parts of the product. A label in the middle covers the product itself. The photo is the seller's best selling tool and the template covers it. | One or two photo shapes for the whole shop. Show the whole product when a photo does not fit (fit inside on a quiet background instead of cutting). Put labels at an edge or under the photo. Make the things on top of a photo fewer and smaller, and keep them off the middle. |
| 6 | P1 | Order page | In the pay box the strongest thing is the black "Upload receipt" button. The amount and the account number are ordinary text, pushed to the far right, far from their labels. "Copy" looks like plain text. The deadline uses the same black number chips as the flash-sale timer. | This is the moment the buyer types numbers into a bank app. They need the amount and the account number first, clearly, with no chance of a mistake. A sale-style timer feels like pressure, which is the wrong feeling when sending money. | Set the bank details like a payment slip: amount and account number largest, in even-width numbers, labels close to values. Make "Copy" look like a button. Show the deadline as calm text with a time, not as sale chips. Keep the seller's logo and name close to this box. |
| 7 | P1 | Checkout | Five outlined boxes, and inside them more outlined boxes (each delivery choice, each payment choice, the pickup store, each field). With black buttons the selected choice turns grey, which reads as "switched off". | Boxes inside boxes make a short form look long and heavy. A grey "selected" state makes the buyer check twice which delivery and payment they chose. | Drop the outer boxes; use space and clear headings to separate the parts. Keep an outline only on the things you tap. Show the selected choice with the seller's colour and a clear mark. |
| 8 | P2 | Brand home, product, checkout | Emoji are used as icons: truck, money, lightning (trust row), lightning (flash sale), lock (checkout). The trust row also mixes in a plain tick. | Emoji look different on every phone and look cheap next to a price. They are on the owner's list. (The truck in the top strip is part of the demo's own text, not the template.) | Use the drawn line icons the Marketplace layout already has, one style everywhere. |
| 9 | P2 | All pages | "Sharp corners" is only half applied. Still round: the search box, the amount stepper, "Save", delivery and payment choices, text fields, small chips, the status label, cart photos. | The seller picks sharp or round and gets a mix. It looks unfinished. | One corner rule for everything, with at most one stated exception. |
| 10 | P2 | Brand home (phone) | "Shop by category" uses very tall tiles, two per row. Seven categories take almost two full phone screens. An odd number leaves an empty hole (also on laptop: 4 per row, 7 tiles). | The buyer scrolls a long way past pictures of categories before reaching New arrivals. The hole looks like something failed to load. | Smaller, shorter category tiles (three per row on a phone, or a shorter shape). Let the last row fill the width when the count is odd. |
| 11 | P2 | Brand home | Six identical all-capitals titles (Best sellers, On sale, Shop by category, New arrivals, How to order, Good to know). Then the Live box, About box, three "How to order" boxes and three question boxes all share one thin grey outline. "How to order" is three same-size boxes with a number in a circle. "About" has three big numbers in a row. | Every section has the same voice, so nothing stands out and the page feels built from a kit. Numbered step boxes and a row of big numbers are among the most common template patterns. | Normal-letter titles with real size steps. Let sections differ: products with no box at all, About as plain text with the numbers in a sentence-like line, steps as a simple list, questions as lines with a divider. |
| 12 | P2 | Home (phone) | The floating chat button is a fixed bright green circle with a shadow. It covers "See all" on the first screen and sits near the "+" of the right-hand card. There is already a Chat tab in the bottom bar. | It hides a link, it can be tapped by accident, and its green fights with whatever colours the seller chose. | Same button, quieter: neutral or the seller's colour, smaller, placed so it never covers a link or a "+". |
| 13 | P2 | Home (both layouts) | The "LIVE" label cannot be read: grey letters on a red patch. Cause: the rule for the grey sub-line also catches the label (`v2/styles.ts`, lines 58 and 61). | A label nobody can read is noise, and red with no words can look like an error. | White letters on the red patch, as the label's own rule intended. A one-line style fix. |
| 14 | P2 | Laptop: home, cart, product | About, How to order and Good to know stretch across the full page width (about 1,120px); the About text runs as one line of about 150 letters. The cart leaves the lower right half empty. On the product page the left column is empty under the small photos while the right column goes on. "On sale" with four items leaves a gap. | Long lines are hard to read. Empty areas make the page look like a phone page pulled wide. | Limit text to a comfortable line length. Put About next to its numbers, questions in two columns, and let the summary column stay in view while the left side scrolls. |
| 15 | P2 | Phone, all pages | Small text: bottom bar labels 10.5px, stats labels 11px, trust row, top strip and step line 12px, most body text 13.5px. Small buttons: heart 30px, "+" 34px, amount stepper 36px, "Remove" and "Copy" are small text. | Hard to read outdoors or for older buyers. Small targets cause wrong taps with one thumb. | Body text 15 to 16px, no text under 12px, tap areas at least 44px (the visible mark can stay small). |
| 16 | P2 | Product, cart, checkout | One grey bar style is used for three different things: the flash-sale timer, "Add NT$130 more for free shipping", and "After you place the order…". | The buyer cannot tell at a glance whether a grey bar is a deal, a tip or an instruction. | Three quiet but different treatments: sale in the seller's sale colour, progress as a slim line with text, instructions as plain text. |
| 17 | P2 | Brand cards, product page | The seller's "sale colour" is painted on the old, crossed-out price. The new price is black. | Red pulls the eye to the price that is no longer true. | Sale colour on the new price or the "% off" tag; old price in quiet grey. |
| 18 | P2 | Cart, checkout, order | The promo strip ("Free shipping over… New drop every Friday") stays at the top in the strongest colour on the pay pages. | A sales message above bank details feels pushy at the moment the buyer needs calm. | Keep the strip, make it quiet on these three pages (thin, neutral colour). |
| 19 | P2 | Marketplace home | Everything is a rounded white card on a grey page. Orange is on prices, "+" buttons, links, tags and the active tab. Two tags, a heart and photo dots can sit on one photo. The banner is a brown-to-red blend with two see-through circles behind a floating product. The flash-sale panel leaves almost half its width empty on laptop. | It reads as a copy of a marketplace app, not as a seller's own shop. When one colour is on everything, nothing is important. | Since this layout is the older one, the simplest path is to give it the same new card, photo and colour rules as the Brand store and drop the circles and the blend. |
| 20 | P3 | Home, product | Browser default parts show through: the black triangles on the questions, the "‹ ›" row arrows typed as letters, the language picker with a wide gap in the footer, no visible focus ring (the search box turns it off), no pressed state on any button. | Small signs that the page was assembled, not finished. Keyboard users cannot see where they are in the search box. | Draw the arrows and the open/close mark in the same icon style. Add a focus ring and a pressed state in the seller's colour. |
| 21 | P3 | Checkout, cart | "Not you?" sits lower than the "Your details" title. The cart shows the same amount as "Items (2)" and "Subtotal", and "Subtotal" again in the bottom bar. Prices and totals do not use even-width numbers. | Minor unevenness on the pages where care matters most. | Line up the title row. Make repeated amounts quieter than the one that matters. Even-width numbers for all money. |
| 22 | P3 | All pages | Fonts: Space Grotesk in capitals with Inter, or Plus Jakarta Sans, or Fraunces with Inter. All three are the usual template picks; Inter is the body font in two of three. | Fonts are a quick "template" signal to anyone who has seen many such sites. Not a problem for most buyers. | Keep three choices, but choose pairs with more character and good Chinese and Thai fallbacks. This needs a seller setting and a database list change, so it is noted here and not assumed. |
| 23 | P3 | All pages | Almost no movement or feedback: one fade on the header. | Adding to cart or copying the account number gives little sense that it worked beyond a short message. | A few small, quick responses: the cart count ticks, "Copy" turns into "Copied", the selected choice settles in. No moving decorations. |

---

## 5. "Looks AI-made" verdict, page by page

The owner's list: generic purple, the same rounded white cards everywhere, centred hero and subtitle,
emoji, fake photos.

### Brand home — **yes, strongly, on the first screen**

Present:
- Blue-to-purple blended band (the default "Ocean"). The owner's "generic purple".
- Centred headline with a centred sub-line under it.
- All-capitals headline and six all-capitals section titles.
- Emoji as icons in the trust row (truck, money, lightning) mixed with a plain tick.
- Eight boxes with the same thin grey outline (Live, About, three steps, three questions).
- Three numbered step boxes (number in a circle, title, one line of text).
- A row of three big numbers with small labels (632 / 12 / 966).
- Small outlined chips in the footer ("Bank transfer", "7-11"…) and a tag-style "LIVE" label.
- A floating round button with a soft shadow.
- Inter as the body font.

Not present:
- Rounded white cards with shadows (the Brand cards have no border and sharp corners).
- Fake photos (all photos are the seller's).
- Glass or blur effects, coloured glows, blended-colour text, decorative shapes.

### Brand product page — **mild**

Present: lightning emoji in the flash-sale bar; black number chips for the countdown; a "-38%" tag;
two outlined boxes (delivery/payment/returns, Details); an all-capitals "You may also like".
Not present: any blend, purple (the purple dot is the product's own colour), centred hero, rounded
shadow cards. The page is not "AI-looking"; it is plain and anonymous.

### Brand cart — **no, just plain**

Present: an outlined box per item and for the summary; a grey bar; all-capitals "Goes well with".
Not present: emoji from the template (the truck in the top strip is demo text), blends, pills.

### Brand checkout — **mild**

Present: boxes inside boxes (5 outer, about 10 inner); a lock emoji next to the privacy line; grey
selected state. Not present: blends, centred hero, decorative shapes.

### Brand order page — **mild**

Present: an orange tag-style status label; five outlined boxes; black countdown chips; four heavy
outlined chat buttons, each with a different bright logo. Not present: emoji, blends.

### Marketplace home — **yes, but a different kind: "marketplace app copy"**

Present:
- **Rounded white cards everywhere on a grey page.** This is the clearest case of the owner's "same
  rounded white cards".
- Blended banner (brown to red) with two see-through circles behind a floating product.
- Four identical cards of icon, title and sub-line under the banner.
- A fully rounded white "Shop the drop" button.
- Lightning emoji in the "Flash sale" title.
- Stacked tags on photos: "-38%", "2 left", "NEW", "#1".
- One accent colour (orange) on prices, "+" buttons, links and tags.
- On laptop: words on the left, product on the right, the standard banner split.

Not present: centred hero, all-capitals titles, purple. Its trust icons are drawn, not emoji, which is
better than the Brand home.

**Overall:** the Brand home's first screen is the page that says "AI-made" loudest, and it is the page
every buyer sees first. The inner pages are not flashy; their problem is that they are nobody's.

---

## 6. Three kinds of buyer (the playbook's check for shops)

**One hand, on the move.**
- Good: the main button is always at the bottom with the total.
- The green chat button covers "See all" and sits next to a "+".
- Heart (30px), "+" (34px) and the amount stepper (36px) are small. "Remove" and "Copy" are small text.
- Almost two screens of category tiles sit between "On sale" and "New arrivals".

**The careful one who tries odd things.**
- Long names are cut to "…" on cards; in the laptop cart row down to one word.
- 7 categories leave a hole. 4 sale items leave a gap on laptop. 3 flash-sale items leave almost half
  the panel empty (Marketplace, laptop).
- A wide logo is cropped to a circle. A tall or wide photo is cut differently on each page.
- A seller who picks pale colours is safe: the readability check handles it.

**First time buying from a small seller, about to send money.**
- At "Place order" the only sign of the seller is a 30px circle. The only reassurance is one small
  grey line with a lock emoji.
- On the pay box "Copy" does not look tappable, and the timer looks like a sale timer.
- Good: the account name matches the shop name, the status says "Waiting for payment" in words, and
  the page says to keep the link.

---

## 7. The five questions

**1. First 3 seconds on a phone: what does the eye land on?**
The blue-to-purple band and the big capital headline, then the two tall tiles with a white label box
in the middle of each. That is the template. The seller's part is a 30px circle and the name in white
at the top. The first real product photo is cut off at the bottom of the screen.

**2. Does it still work for food or gadgets?**
The flow works for anything; the options, sizes and "condition" lines come from the seller's own data.
What looks odd: tall 4:5 tiles and cards suit clothes on a body, but food is usually shot square or
wide and gadgets as a box on white, so cropping cuts them. Names like a phone model with memory size
will be cut to "…" even sooner than clothes names. A label box in the middle of a tile would sit right
on the dish or the device.

**3. Where does the seller's identity show, and where is it drowned?**
It shows in the home band colours, the thin top strip, the shop name, the photos and the About text.
It is drowned by the forced 30px round logo, by labels and buttons laid over the photos, and by the
fact that every working part below the band is black, white and grey. On cart, checkout and order
pages the seller is almost absent.

**4. Cart to checkout to order page: calm and trustworthy for a bank transfer?**
It is clear and honest: fees, total, steps and what happens next are all stated. What adds doubt: the
shop is a tiny circle at the moment of paying; the amount and account number are not the strongest
things in the pay box; "Copy" looks like text; the deadline uses the same chips as a flash sale; a
promo strip sits above the bank details; and the selected delivery and payment choices are grey.

**5. Laptop at 1280: good use of width, or a stretched phone page?**
Mixed. Product, checkout and order pages use two columns well. The home page is a phone page pulled
wide: two huge tiles fill the first screen, then full-width boxes with very long text lines and holes
where a row is not full. The cart leaves its lower right half empty and squeezes five tiny cards into
the left side.

---

## 8. Small notes

- Side margin on phones is 12px. Photos in rows almost touch the screen edge while text does not line
  up with them. A slightly wider, steady margin would feel calmer.
- The "1 / 3" photo counter and the small photos under it both show the same thing on the product page.
  Fine to keep both; make one of them quiet.
- "Add to cart" (outline) and "Buy now" (filled) are both heavy black. The filled one is clearly first,
  which is right.
- The four chat buttons on the order page are as loud as "Upload receipt". They can be lighter.
- The header search box takes most of the header on a phone and pushes the shop name off inner pages.
  Its size is a look choice; a smaller search would give the logo room without moving anything.
- The "Verified seller" green tick next to the About title is typed as a tick character, like the one
  in the trust row.
- Dark mode was not pictured, so it is not judged here.

## 9. Things for the owner to think about

- Should a new shop start from a quiet neutral look, so that the seller's logo and photos are the only
  colour until the seller picks one?
- If only one thing may carry the seller's identity on the pay pages, should it be the logo at a real
  size next to the bank details?
- Is the Marketplace layout worth a separate look, or should it simply inherit the new Brand store
  rules?
- New font pairs need a seller setting and a database list change. Is that in scope, or should the
  three current choices stay for now?

---

## 10. Files

- This report: `docs/design/website-redesign/critique.md`
- Helper that cuts tall pictures: `docs/design/website-redesign/harness/crit-crops.cjs`
- The cut pieces: `docs/design/website-redesign/crops/` (24 pictures)
- Nothing under `src/`, `server/`, `sql/`, `api/`, `chrome-extension/`, `mobile/` or `.claude/` was
  changed. No skill script was run. Nothing was committed.
- Seen, not touched: an untracked folder `.claude/skills/ui-ux-pro-max/scripts/__pycache__/` was
  already there before this step.
