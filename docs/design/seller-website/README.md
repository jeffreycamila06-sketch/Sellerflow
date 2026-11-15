# Seller Website — Phase 1 (branch `claude/seller-website`, NOT merged, sql/163 NOT applied)

## Screenshots (`shots/`)
Every screen at three widths: `_iphone` (iPhone 13, 390 px), `_android` (Pixel 7, 412 px), `_laptop` (1280 px).
Demo data only. Taken with `harness/` — the buyer pages run the REAL shop app with its database calls
answered by `harness/shoot.cjs`; the seller screens get fake data through their `api` props.

| File | Screen |
|---|---|
| buyer-1-home | Shop home: cover, logo, name, verified, stats, Chat with us, Follow us, live, categories, sort, grid, about, policy, Powered by |
| buyer-2-product | Product: gallery, Size / Color picker (L / XL sold out, crossed), qty, Add to cart / Buy now |
| buyer-3-cart | Cart: free-shipping bar, qty, subtotal |
| buyer-4-checkout | Checkout: remembered details + Not you?, delivery, store, payment, summary, privacy note |
| buyer-5-store-pick | Store number + name, official map link, recent stores |
| buyer-6-order-sent | Order sent: W number, steps, bank details, Upload receipt, Send to chat, order link |
| buyer-7-order-link | Order link after a receipt was sent |
| buyer-8-closed | "This shop is closed" (plan expired / switch off) |
| seller-1-website-editor | Editor (Pro): address + Copy, Published / changes, Preview / Publish, own domain row, look, info, socials, chats, sections |
| seller-2-editor-free-android-web | Free plan on Android / web: locked Publish + "Upgrade to publish your website" |
| seller-3-editor-free-ios | Free plan on iOS: locked Publish, no plan name / price, no own-domain row |
| seller-4-orders-website-tab | Orders → Website tab with badge + filters |
| seller-5-order-detail | Order detail: receipt with "Check your bank app first", actions |
| seller-6-products | Products with the Website button + variant total |
| seller-7-product-website-sheet | Website & variants sheet |
| seller-8-payment-shipping | Payment & shipping |

Re-take: `VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort`
then `node docs/design/seller-website/harness/shoot.cjs`.

## Other notes
- `store-lookup-audit.md` — the existing store lookups and the proposal.
- `chat-apps.md` — which chat app opens with the order typed in, doc links, real-phone test list.
