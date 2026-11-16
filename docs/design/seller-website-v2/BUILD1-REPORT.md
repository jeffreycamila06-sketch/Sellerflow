# Seller Website v2 — Build 1 report

Branch `claude/website-v2` (from main `792b5445`). **Not merged. No SQL applied. Nothing deployed.**
The website is still behind the same gate as today (`seller_website_enabled` off, testers only).
Untouched: printing, Live, Auto Mode, Parcel Scan, Pickup Status, the Chrome extension.
A product with none of the new fields answers exactly as before, in live and on stickers.
Everything that protects orders is still there: prices and stock checked by the database at order time, rate limits, 24 h auto-cancel, receipts.

## Commits (one per item)
| Commit | Item | What changed |
|---|---|---|
| `067fff32` | 8 product fields | Optional old price, flash price + end (website only, applied at order time by the database), condition, size guide, colour group + swatches (in the existing option json). |
| `14cde575` | 9 sold totals | "N sold" + Best sellers from real sold units (live, 1-Click, website, waitlist). The totals are kept forever: a running total survives the 90-day stock-history purge. |
| `c4fbad9d` | 13 courier + tracking | "Mark as shipped" asks for courier + tracking number (both optional). "Edit tracking" afterwards. The buyer sees them once the order is shipped. |
| `293c54bc` | 10 shipping list | The seller's own shipping options: fee, free over, note, what the buyer gives, pay on delivery per option. Ready lists for TW / CA / AU / PH / other countries. A shop with no saved list behaves as today. |
| `4e8ce624` | 11 payment list | The seller's own payment methods: instructions, QR, bank details, pay first or on delivery. Ready lists per country. The order link shows the picked method. |
| `70df5ecf` | 12 country | CA / AU address parts. Phone check, currency and language follow the country (Philippines → English). Optional "Prices include tax" line. |
| `43f79e5a` | 6 themes | Pop / Boutique / Bold plus the accent colour, and one shop frame: announcement bar, header, footer, phone bottom bar, chat sheet. |
| `ee5a9ed6` | 2 cards | Swipeable photos, badges, colour dots / sizes, struck-through price, "N sold", heart, quick add. |
| `db6f35c5` | 7 saved on device | Saved items and "your orders" are kept on the device, per shop (no account). |
| `d57cc618` | 3 shop page | Category / size / in-stock / on-sale filters, sort (no "top rated"), empty state. |
| `fe03bb03` | 1 home | Slides, trust badges, categories, next live, flash sale, best sellers, promo, new arrivals, about, how to order, FAQ. Each part has its own switch in the editor. |
| `be293edf` | 4 product page | Gallery, swatch / size buttons, stock line, delivery total by the buy buttons, how to pay, returns, details, size guide, related items, sticky phone bar. |
| `9903d735` | 5 cart / checkout / order | Steps bar, free-shipping progress, one-page guest checkout with the summary always in view, order timeline, receipt upload, auto-cancel line, chat. |
| `576265dc` | help guide | Website section of `docs/support/sfl-guide.md` updated; `sql/116b` regenerated (not applied). |
| `47af9dbe` | proof tools | `harness/compare.cjs`, `harness/shoot.cjs` |
| `f53deb25` | fix | Fix found in the compare shots: a long line in the phone cart could make the page wider than the screen. |
| `c6251b35` | audit fix 1 | **Price changed between view and order.** The page sends the total it showed (items + shipping). Different from the database's total → NO order, NO stock, answer `price_changed` with the new total; the page shows the new prices and the buyer confirms again. An old page that sends no total behaves as today. |
| `680cb84d` | audit fix 2 | **How to pay stays on the order link.** A copy of the picked method (name, instructions, QR path, bank details) is kept on the order and shown while payment is due — also after the seller edits, turns off or deletes the method. |
| `14f7c8f6` | merge main | Invite friends merged in. Only conflict: `scripts/sql165-behaviour.mjs` (main's kept; this branch's → `scripts/sql167-behaviour.mjs`). Website SQL renamed to `sql/167_seller_website_v2.sql` (+ rollback). Help guide auto-merged, sql/116b regenerated (identical), 51 ids, none lost. |
| `ae63e044` + `f48a1291` | 2a logo letter | The header letter already used the theme colour (the seller's own only when picked); the orange "B" in the old pictures was the harness's uploaded logo PICTURE. Harness fixed (no logo picture, like the preview) and the rule pinned by a test. |
| `9c583bfc` | 2b countdown | Order page while payment is due: "Auto-cancels in HH:MM:SS" counting down to the order's real auto-cancel time, the sentence kept under it. |

Left out on purpose (Build 2): vouchers, "What buyers say". Ratings are hidden everywhere.
New words exist in all 8 languages. The iPhone app shows no plan / price / upgrade words.

## Screenshots
- `fix-2ab/before` + `fix-2ab/after` — 2a header (Boutique, Bold; + a seller-picked colour) and 2b order page, iPhone + laptop, preview next to the build.
- `compare/` — **72 pictures** (remade after 2a/2b): the preview (`site-v2.html`, left) next to the real build (right), for each theme (pop / boutique / bold) × page (home, shop, product, cart, checkout, order, saved, orders) × iPhone / Android / laptop. Named `<theme>-<n>-<page>_<device>.jpg`.
- `shots/walk-CA-*` and `shots/walk-AU-*` — **Canada and Australia checkout walk-through**, iPhone + laptop:
  1. cart
  2. empty checkout (errors shown)
  3. filled checkout: street / city / province / postal code for CA, street / suburb / state / postcode for AU; Interac (CA) or PayID (AU); CA$ / A$
  4. the order link
- `shots/seller-*` — the seller side, iPhone / Android / laptop: the website editor (themes + Home page card), Payment & shipping for TW and for CA, and the "Mark as shipped" form with courier + tracking.

How to remake them: `VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort`, then run `node docs/design/seller-website-v2/harness/compare.cjs` and `node docs/design/seller-website-v2/harness/shoot.cjs walk-` (or `seller-`).

## Results
- **SQL proof:** `scripts/sql167-behaviour.mjs` → **148 passed, 0 failed** (PGlite; includes the rollback narrowing the delivery check, the shared checkout cases the app's mirror is also tested against, the two audit fixes — 8 / 5 checks go red with each fix removed — and 6 checks that sql/167 and sql/165 Invite friends apply in either order).
- **Full test suite:** 693 files passed (1 skipped), **8,992 tests passed** (9 skipped), 0 failed (after the main merge + 2a/2b).
- **Typecheck:** clean. **Build:** green. **Lint:** 56 errors / 6 warnings, the same as main (all were there before; none added).
- **CI:** green on `47af9dbe`. For `f53deb25` (CSS only), see the final message.

## SQL — `sql/167_seller_website_v2.sql` (+ `sql/167_seller_website_v2_rollback.sql`), NOT applied
Add-only. It needs sql/163 and sql/164. The rollback puts back the sql/163 functions word for word; it narrows the delivery check only when no order uses 'store' or 'pickup'.

| Part | What it adds |
|---|---|
| PART 1 | `website_public_fields` lets the v2 home page through: theme, slides ≤ 5, trust badges ≤ 4, promo, steps ≤ 3, FAQ ≤ 8, category pictures ≤ 30. Only site pictures the seller uploaded are allowed. |
| PART 8 | `products.old_price / flash_price / flash_end / item_condition / size_guide` (nullable). The flash price is applied in `website_place_order`. |
| PART 9 | `product_sold_totals` + a trigger on `stock_movements` (it can never fail a stock write) + a one-time fill from today's history. |
| PART 10 | `website_checkout_v2(settings, country)`, `website_shop` answers `checkout2`. `website_place_order` takes `ship` (no `ship` → exactly sql/163). New columns `website_orders.ship_id / ship_name`; delivery check widened with 'store' and 'pickup'. |
| PART 11 | `settings.payMethods` (≤ 8, checked), new columns `website_orders.pay_id / pay_name`; `website_order` returns the picked method while payment is due. |
| PART 12 | `taxIncluded` in `checkout2`. |
| PART 13 | `website_orders.courier / tracking_no`, `website_order_ship()`; the buyer sees them once shipped. |
| AUDIT FIX 1 | `website_place_order` compares `p_order.shownTotal` with its own total → `price_changed` (no order, no stock). |
| AUDIT FIX 2 | `website_orders.pay_copy` (jsonb, ≤ 4 KB), filled at order time; `website_order` shows it while payment is due. |

Apply order when ready: the website v2 SQL first → then the web merge. sql/116b (guide) after the merge.

**Numbering (done):** main has Invite friends as `sql/165_invite_referral.sql` + `sql/166_guide_invite_friends.sql`
(+ its own `scripts/sql165-behaviour.mjs`). After merging main, this branch's files are `sql/167_seller_website_v2.sql`
(+ rollback) and `scripts/sql167-behaviour.mjs`. sql/167 needs sql/163 + sql/164 and does not depend on 165 / 166
(the proof applies them in both orders).
