Seller Website v3 — "Brand store" layout + the seller sets the look.

Jeff approved the attached preview (`site-v3.html`; open it in a browser: it is clickable, with iPhone / Android / Laptop and a "🎨 Ayusin ang itsura" panel). Put it in `docs/design/seller-website-v3/`. If you cannot open the file as a real file, STOP and tell me; do not work from pasted text or from memory.

Branch `claude/website-v3` from main. One commit per numbered item. Do NOT merge, apply SQL or deploy. If SQL is needed: ONE new add-only file (next free number) with rollback and proof checks like sql/167's. The website stays gated exactly as today (`seller_website_enabled` off, testers only). Printing, Live, Auto Mode, Parcel Scan, Pickup Status and the extension are untouched. Everything that protects orders stays (prices from the database, stock checks, rate limits, 24h auto-cancel, receipts). Checkout, order page, shipping and payment logic do not change.

**A. Two layouts the seller chooses**
1. **Brand store** (new, as in the preview): colour band at the top that the header sits on (header is see-through at the top of Home and turns solid when the buyer scrolls); two big tiles; product rows that scroll sideways, with arrows on laptop; category tiles with "from <lowest price>"; next live; about; how to order; FAQ. Sections the seller turned off or that have nothing to show stay hidden, as in Build 1. The seller's Build 1 home content (slides, trust lines, category pictures, promo, steps, FAQ) is reused: slide 1 gives the band's title and text; the two big tiles are the first two categories with pictures (seller can change which).
2. **Marketplace** = today's Build 1 layout, unchanged in structure.
3. Brand-store product card: no box, photo swipe kept, one badge bottom-left of the photo (Sold out / "N% Off" / "N left" when 2 or fewer / New), colour swatches, name, "N sold", price with the old price struck through in the sale colour.
4. Quick add in Brand store: on phones a "+" on the card opens a size sheet; on laptop the sizes show over the photo on hover. Sold-out sizes disabled. A product with more than one colour, or with no sizes, follows the Build 1 quick-add rule (open the product page when a choice is still needed). After adding, the cart opens as a panel (right side on laptop, from the bottom on phones) with quantity, remove, free-shipping progress, subtotal, Checkout, Keep shopping. The full cart page still exists.
5. Shop page, product page, checkout and order page keep their Build 1 structure in both layouts; they only take the new colours, font and corner shape.

**B. What the seller sets (Website editor, with a live preview)**
6. Layout; top colour 1 and 2 (two different colours = a blend); button colour; sale colour; light or dark page body; font (Modern / Friendly / Classic); corners (sharp / round). Five ready combinations as in the preview (Ocean, Midnight, Blush, Forest, Sunset) that fill these in and stay editable.
7. Contrast guard, as in the preview's `applyCfg()`: text on the top band and on buttons is picked automatically (white or dark); a button or sale colour that cannot be seen on the body is replaced by a safe one, and the editor tells the seller in one line. The buyer's shop must never show unreadable text, whatever the seller picks.
8. Existing shops must look exactly as they do today until the seller changes something: the three Build 1 themes (Pop, Boutique, Bold) and the shop colour map to Marketplace with matching settings. Show me the mapping before building it. New shops start on Brand store + Ocean.

**Rules**
- Every new word in all 8 languages. iPhone app: no plan / price / upgrade words (as today).
- Help guide: update the Website section, user-level wording only. Regenerate the seed but do not apply it.
- If a rule is unclear, ask me; do not guess.

**Report**: what changed per commit; screenshots of the real build next to the preview at iPhone, Android and laptop width for: Brand store × the 5 combinations, Marketplace × light and dark, plus one deliberately bad colour pick showing the guard; proof that an existing shop (theme null, and each of Pop / Boutique / Bold) renders the same before and after; a full order placed in Brand store on phone width; proof-script count; full suite; real lint count compared with main; CI on the last commit; the SQL file name and what it adds (or "no SQL").

Build 2 (vouchers, reviews, bundle deals): do not start.
