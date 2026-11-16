# Seller Website hotfix — proof

All screenshots are taken in the **real app shell**: `index.html` → `RedesignApp` (header, Settings →
Website, the app's bottom bar), at iPhone 13 (390 px), Pixel 7 (412 px) and laptop (1366 px).
Every Supabase call is answered by `app-shell/shoot.cjs` with demo data — no real database.

Run: `VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5198 --strictPort`
then `node docs/design/seller-website-hotfix/app-shell/shoot.cjs [preview|publish|all]`
(`SHOT_PREFIX=before-` with main's `WebsiteEditor.tsx` in place gives the before shots).

## 2. Preview on top of the whole app

| | before (main) | after |
|---|---|---|
| opening (150 ms) | `before-preview-1a-opening-*` — the editor shows THROUGH the preview, Close floats on the app header | `preview-1a-opening-*` — opaque from the first frame |
| open | `before-preview-1-open-*` — shop cards overlap the shop header, app bottom bar on top | `preview-1-open-*` — the shop as buyers see it, bottom bar covered |
| scrolled | — | `preview-1b-scrolled-*` |
| closed | — | `preview-2-closed-*` — back to the editor |

Measured in the page (all three widths, after):
`parentIsBody:true, opacity:1, z:5000, navCoveredBySheet:true, closeVisible:true`.
Before: `parentIsBody:false, z:1000, navCoveredBySheet:false`, ancestor `.sfl-anim-screen` (animation `sflScreenIn`).

## 3. Publish feedback

| file | what it shows |
|---|---|
| `publish-0-has-changes-*` | "You have changes that are not published yet." + **Publish** |
| `publish-1-publishing-*` | tapped: **Publishing…** with a spinner (also while the draft is being saved first), disabled |
| `publish-2-published-toast-*` | green **✓ Published** on the button + toast **Your website is live** |
| `publish-3-up-to-date-*` | ~3 s later: **Published ✓** (outlined, disabled) — nothing new to publish |
| `publish-4-error-*` | the database answers "upgrade needed": red reason under the buttons + **Upgrade ›** + toast; button back to **Publish** |
