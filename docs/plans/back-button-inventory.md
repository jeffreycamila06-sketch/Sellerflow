# Back button — inventory + proposal (Step 1, for Jeff to approve)

Branch `claude/back-button`, from main `dc30bda8`, 2026-11-11. **No app code changed.** This file lists every
screen in `RedesignApp.tsx` (`screen === "…"`), where it opens from, whether it has a Back today and where that
Back goes, plus the proposed Back target. Then a proposed rule, the special cases, Android back, and the
questions for Jeff. Preview pictures: `docs/design/back-button/`.

How navigation works today: one `screen` state, changed with `setScreen(...)`. The app never adds browser
history entries (no `pushState`), so there is no "previous screen" anywhere except two small helpers:
`chanBack` (the Live / channel screens) and `psBack` (Printer settings). The bottom nav (sidebar on a laptop)
is the only way out of most sub-screens.

## A. Inventory

**Home** = a bottom-nav tab (no Back, ever): Live, Sales, Orders, Products, Settings.
"Back today": **yes** = has a Back button in its header; size given when it is under 44 px.

| # | Screen key | What it is | Opens from | Back today | Proposed Back goes to |
|---|---|---|---|---|---|
| 1 | `dashboard` | **Live** | nav tab; after login | — **home** | — (no Back) |
| 2 | `salestab` | **Sales** | nav tab | — **home** | — |
| 3 | `orders` | **Orders** (also its Miners tab inside the screen) | nav tab; cap popup "View my orders"; Sales → tap a buyer | — **home** | — (Miners stays a tab inside Orders) |
| 4 | `products` | **Products** | nav tab | — **home** | — |
| 5 | `menu` | **Settings** (the tile hub) | nav tab | — **home** | — |
| 6 | `settings` | General Settings | Settings hub; no-printer popup "Go to Printer Settings" | **no** | where it came from (Settings hub; or the screen the popup was on → see Q4) |
| 7 | `customers` | Customers | Settings hub | **no** | Settings hub |
| 8 | `subscription` | Subscription (hidden on iPhone) | General Settings; free-limit popup "Upgrade" (any screen); 7-11 Shipping "Upgrade" | **no** | where it came from |
| 9 | `support` | Support / help | General Settings | **no** | General Settings |
| 10 | `admin` | Admin (admins only) | its own nav button (admins); Settings hub | **no** | from the nav: no Back (Q5); from Settings hub: Settings hub |
| 11 | `shipping` | 7-11 Shipping (gate "open") | Settings hub | **no** | Settings hub |
| 12 | `customerdata` | Customer data | Settings hub | **no** | Settings hub |
| 13 | `legal` | Privacy / Terms | Settings hub; Support; Customer data; **Signup and the landing page (signed out)** | **no** | where it came from. ⚠️ Signed out there is no bottom nav either — today a visitor is **stuck** on Legal |
| 14 | `delete` | Delete account | Settings hub; General Settings | **yes** — 32×32 "‹" icon only + "Keep my account" button; **always** goes to General Settings | where it came from (Settings hub or General Settings) |
| 15 | `printersettings` | Printer settings | General Settings printer picker; printer setup guide "OK"; Live print pattern "Change" | **yes** "‹ Back" (≈32 px) → `psBack` (General Settings or Live print pattern) ✓ origin-aware | same (already right) — make it 44 px |
| 16 | `printpattern` (new sticker) | **Live print pattern** (`OneStickerPattern`) | General Settings | **yes** "‹ Back" **44 px** → General Settings (drops the unsaved draft) | same — **this is the reference look** |
| 17 | `printpattern` (old sticker) | Print pattern (`PrintPattern`) | General Settings | **yes** "‹ Back" (≈32 px) → General Settings | same — make it 44 px |
| 18 | `ttchannels` / `fbchannels` | Manage TikTok / Facebook accounts | General Settings channel rows; Live account dropdown "Manage / add accounts"; Connect with no account | **yes** "‹ Back" (≈32 px) → `chanBack` (General Settings or Live) ✓ | same — make it 44 px |
| 19 | `shopeechannels` | Shopee shops | Manage accounts screen; Live Shopee chip "Manage"; connect sheet "Authorize" | **yes** "‹ Back" (≈32 px) → `chanBack` | from Manage accounts: back to **Manage accounts** (today it skips it and lands on General Settings — Q6); from Live: Live |
| 20 | `fbpages` | Facebook pages | Manage accounts; Live FB chip / Connect with no page | **yes** "‹ Back" (≈32 px) → `chanBack` | same as #19 |
| 21 | `igaccounts` | Instagram accounts | Manage accounts; Live IG "Manage" / Connect with no account | **yes** "‹ Back" (≈32 px) → `chanBack` | same as #19 |
| 22 | `parcelscan` | Parcel Scan 7-11 | Settings hub tile; FamilyMart ⇄ 7-11 | **no** (has ⇄ 全家 on the right) | Settings hub (⇄ never stacks — see special case) |
| 23 | `fmparcelscan` | Parcel Scan FamilyMart | Settings hub tile; 7-11 ⇄ 全家 | **no** (has ⇄ 7-11 on the right) | Settings hub |
| 24 | `customerdetails` | Customer Details (7-11 phonebook) | Settings hub tile | **no** | Settings hub |
| 25 | `parceltracking` | Pickup Status | Settings hub tile | **no** | Settings hub |
| 26 | `receiptformat` | Receipt format (Facebook) | Settings hub | **yes** "‹ Back" (≈32 px) → Settings hub ✓ | same — make it 44 px |
| 27 | `print` | Print stickers (batch / reprint) | Orders "Print" | **yes** 32×32 "‹" icon only → Orders ✓ | same — make it the "‹ Back" text button, 44 px |
| 28 | `landing` | Landing page (signed out, web) | app start (web, signed out) | — root | — |
| 29 | `login` | Log in | app start (app shell, signed out); landing "Log in" | — root | — (no Back) |
| 30 | `signup` | Sign up | Log in "Sign up" | **yes** "‹ Back" (≈32 px) → Log in ✓ (+ "Log in" link) | same — make it 44 px |

Totals: 5 home tabs · 3 roots (landing / login, signup has one) · **11 sub-screens with no Back** (#6–13, #22–25)
· 12 with a Back (#14–21, #26, #27, #30 — only #16 is 44 px; #14 and #27 are an icon without the word).

## B. Proposed rule (not built — for approval)

1. **One "‹ Back"** at the top left of the header of every sub-screen — exactly the Live print pattern button:
   `rgba(255,255,255,.18)` on the header colour, white 13 px bold, radius 9, padding 9/12/9/9, **min height 44 px**,
   text = the existing key `rd_back` ("‹ Back" / "‹ Bumalik" / "‹ 返回" / "‹ Quay lại" / "‹ กลับ" / "‹ Kembali" /
   "‹ Назад" — already in all 8 languages). The title moves right of it; the subtitle stays under the title.
   One shared component so every screen looks the same.
2. **Back goes to where the seller came from**, not always the first tab. One small "came from" record in
   RedesignApp: opening a sub-screen remembers the screen it was opened from; Back returns there. Tapping a
   bottom-nav tab clears it (a tab is a fresh start). The existing `chanBack` and `psBack` fold into it.
3. **Screens that already have a Back** (#14–21, #26, #27, #30): keep where they go (all already origin-aware
   except Delete account and the Shopee/FB/IG-from-Manage-accounts case), but use the same shared button:
   - 9 of them are "‹ Back" at ≈32 px → raise to 44 px (same look otherwise).
   - Delete account (#14) and Print stickers (#27) show only a "‹" icon in a 32 px square → the word "‹ Back", 44 px.
   - Delete account always goes to General Settings even when opened from the Settings hub → go to where it came from.
   - The extra bottom buttons that also leave (Delete: "Keep my account"; Printer settings: "Done";
     old Print pattern: "Save settings") stay as they are.
4. **Special cases**
   | Case | Today | Proposal |
   |---|---|---|
   | Unsaved changes — Live print pattern | Back drops the unsaved draft silently | keep (Q3) |
   | Unsaved changes — General Settings profile form, Manage accounts, Receipt format, Printer settings Custom size | Back / leaving drops typing | keep; or ask "Leave without saving?" (Q3) |
   | Parcel Scan 7-11 / FamilyMart with ⇄ | no Back; ⇄ swaps in place | Back on the left, ⇄ stays on the right. ⇄ never adds a step: from either screen Back → Settings hub. Typing is still kept by the bridge drafts |
   | Log in / Landing | roots | no Back |
   | Sign up | "‹ Back" → Log in | keep, 44 px |
   | **Legal while signed out** (from Landing or Sign up) | **no Back and no nav → stuck** | Back to where it came from (Landing / Sign up) — the real gap to fix first |
   | Admin | own nav button + Settings hub tile | no Back when opened from its nav button (it is a tab for admins); Back to Settings hub when opened from the tile (Q5) |
   | Admin panels (Manage sellers, Broadcast, …) | full-screen panel with × | keep the × (it is a panel, not a screen) |
   | Popups / sheets (connect sheet, session picker, free-limit popup, expiry / update popups, printer setup guide, no-printer popup, Bluetooth-off popup, Customer Details inside Parcel Scan, receipt sheet, raffle wheel) | each has × / Close / Maybe later | no Back inside popups; they keep their own close |
   | Opened from a popup (e.g. Subscription from the free-limit popup on Live; General Settings from the no-printer popup) | — | Back returns to the screen under the popup (Live / Orders …), popup closed (Q4) |
   | Orders ↔ Miners | a tab switch inside Orders | not a screen — no Back |
5. **Android hardware back** — today (from the code, not tested on a phone): the Android app has no back
   handler (no `@capacitor/app`; Android plugins are locked to none on purpose), and the app never adds history
   entries, so the system back **leaves the app (goes to the home screen) from every screen**, even from a
   sub-screen or with a popup open. Proposal: (a) close the top popup if one is open; (b) else do the same as
   "‹ Back"; (c) on a home tab, leave the app as today. This needs a **small native change** in
   `MainActivity.java` (catch the system back and ask the page first) → a **new Android build** (versionCode ≥ 7)
   through Play; the web part can ship first and does nothing until that build. iPhone has no back key
   (the edge-swipe back is off in the app view; not proposed).
   Laptop: optional — the Escape key could do the same as "‹ Back".

## C. Questions for Jeff

1. Approve the rule above (one shared "‹ Back", 44 px, top left, the Live print pattern look, 8 languages)?
2. Back = **where you came from** (proposed) — or always the Settings hub / tab home?
3. Unsaved changes: keep today's behaviour (Back drops them, like the Live print pattern), or ask
   "Leave without saving?" on the screens listed in 4?
4. A screen opened from a popup (Subscription from the free-limit popup, General Settings from the
   no-printer popup): Back to the screen under the popup (proposed), or to the Settings hub?
5. Admin: no Back when opened from its own nav button (proposed), or always a Back to the Settings hub?
6. Shopee / Facebook pages / Instagram opened from Manage accounts: Back to **Manage accounts** (proposed)
   instead of today's General Settings?
7. Android back: OK to plan the native change (new Android build) — or web Back only for now?
8. Fix the signed-out Legal "stuck" case first, as part of this?
