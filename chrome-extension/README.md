# SellerFlow Live Comment

Chrome extension for grabbing visible TikTok LIVE viewer comments and sending them to SellerFlowLive.

## What It Does

- Shows a movable floating widget on TikTok pages.
- Has `START` and `STOP` buttons.
- Remembers if it was started, then auto-starts again on TikTok pages.
- Captures only likely real viewer comments.
- Ignores common non-comment activity such as likes, joins, follows, viewers, gifts, rankings, and system text.
- Sends captured comments directly to an open SellerFlowLive tab through Chrome extension messaging.
- Optional backend URL field can be used as fallback, for example `http://localhost:3001`.

## Install In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder: `chrome-extension`.
6. Open SellerFlowLive in another tab and make sure you are logged in.
7. Open a TikTok LIVE page.
8. Click `START` in the floating `SellerFlow Live Comment` widget.

## Notes

- Keep SellerFlowLive open so it can receive comments from the extension.
- The widget can be dragged anywhere on the page by holding the widget body/header.
- If you want backend fallback, type your backend base URL into the optional backend field.
- TikTok layout changes can require selector updates.

---

# Parcel checker (v1.1) — 賣貨便 full-store + restricted-phone

A second, independent feature in the same extension. It checks each new
`parcel_scans` row against 7-11's 賣貨便 using **your logged-in 賣貨便 session** —
the two things the server can't do — and writes the verdict back to SellerFlowLive
so the app shows the ⚠️ Full / 🚫 Restricted badges. **It never submits an order.**

## Required open tabs (THREE — keep all logged in)

The two 7-11 checks live on **different origins**, so each runs in its own tab
(same-origin = session cookies + the page's own tokens attach automatically):

- **SellerFlowLive** — for the Supabase token + reading/writing parcel_scans.
- **myship.7-11.com.tw** — the RESTRICTED-PHONE check (CheckoutValidation). Be on
  the **確認訂單 cart page** (`/cart/easy/GM…`, CPF3102) — that's where the AJAX
  token (`var tokenID`) lives; /Home does not have it. The extension also tries a
  read-only GET of `/cart/easy/<Cgdm_Id>` if the current page lacks it.
- **emap.pcsc.com.tw** — the FULL-STORE check (byIDData + eshopGuid live here, NOT
  on myship). Reach it from 賣貨便's store map so the session/eshopGuid are present.

## One-time setup (popup)

1. Open a **SellerFlowLive** tab and log in (keep it open).
2. Open a **myship.7-11.com.tw** tab and log in (keep it open).
   - Best on the **確認訂單 cart page** (`/cart/easy/GM…`) so the AJAX token is present.
3. Open an **emap.pcsc.com.tw** tab (from the 賣貨便 store map) — keep it open.
4. Click the extension icon → **Parcel checker** section, fill in:
   - **Supabase URL** — prefilled (`https://sqeuyuktdpidmlfpqgoc.supabase.co`).
   - **Supabase anon key** — the *public* key the web app already uses. Get it
     from the SellerFlowLive tab: DevTools → Network → any `…supabase.co/rest/…`
     request → Request Headers → copy the `apikey` value. (It's public/anon — safe.)
   - **賣場 GM id (Cgdm_Id)** — your 賣貨便 shop GM id (e.g. `GM2609096130694`).
   - **Seller phone (ordMobile)** — your own phone used as the sender.
4. **Save config.** The checker polls every ~5s while the tabs are open.
   **Pause/Resume** and **Check now** are in the popup.

## How it works (files)

- **`background.js`** (appended section) — a self-scheduling **~5s** poll loop (a
  keepalive alarm restarts it if the service worker was suspended): reads your
  access token from the SFL tab (via the bridge), `GET`s up to 5 unchecked rows
  from `parcel_scans` (own-scoped RLS), then per row sends the **store check to the
  emap tab** and the **phone check to the myship tab** (2s apart, single-flight) and
  `PATCH`es the combined verdict back. Never persists its own session. Records the
  exact reason for each 'unknown' so the popup can show it. The ~5s cadence is
  still human-scale — a seller saves 1-2 parcels at a time, not in bulk; single-
  flight (by id) + a 2s per-parcel gap keep it from overlapping or stampeding.
- **`sellerflow-bridge.js`** — answers `SFL_GET_TOKEN` by reading
  `localStorage["sf_supabase_auth"]` (the token the web app already keeps fresh).
- **`emap-711.js`** (on `emap.pcsc.com.tw`) — **Full store:**
  `POST /ecmap/byIDData.aspx` → field 3 `enable`→open / `disable`+`close`→full. `eshopGuid`
  read by regex of the emap page HTML first, then a MAIN-world script fallback.
  (This is why an emap tab is required — the old build ran this cross-origin from
  myship, so it had no emap cookies and no eshopGuid → always 'unknown'.)
- **`myship-711.js`** (on `myship.7-11.com.tw`) — **Restricted phone:**
  `POST /CPF3101/CheckoutValidation/` (validation only) → `Status:true`→ok,
  `false`→restricted (+ the 預計…年月日 date). Header `VerificationToken` = the
  inline-script JS var **`var tokenID = '…'`** on the 確認訂單 cart page (NOT the
  cookie, NOT a hidden input/meta) — read from the current page, else a read-only
  GET of `/cart/easy/<Cgdm_Id>`. Cgdm_Id from config (bonus: the page's
  `#Cgdm_Id` hidden input) + ordMobile from config.

## FAIL-SAFE

On **any** doubt — no token, no tab, expired session (HTML/redirect), bad shape,
network error, 10s timeout, or a page value it can't find — it writes **`unknown`**,
never `ok`/`open`. An unconfirmed parcel is never made to look clean. `unknown` is
a real "tried, couldn't"; only `NULL` means "not yet tried".

## ⚠️ If a check still returns `unknown`

**Read the popup's "Last error" lines first** — the exact reason for the last
store/phone 'unknown' is shown there (e.g. "eshopGuid not found on emap page",
"no emap.pcsc.com.tw tab open", "verificationtoken not found (open a cart page)",
"byIDData unexpected response", "CheckoutValidation returned HTML"). No DevTools
needed. Common fixes:
- "no emap tab" / "eshopGuid not found" → open (and stay on) an emap.pcsc.com.tw
  page reached from the 賣貨便 store map.
- "tokenID not found" → open the 確認訂單 cart page (`/cart/easy/GM…`) in the myship tab.
- "Cgdm_Id / seller phone not set" → fill them in the popup config.

The page-derived values differ per 7-11 build. If the reason says a value wasn't
found even on the right page, confirm the exact name once in that tab's DevTools:
- `eshopGuid` (emap) — `typeof eshopGuid` / search the emap page source.
- `VerificationToken` (myship) — the inline-script `var tokenID = '…'` on the
  確認訂單 cart page (`/cart/easy/GM…`). NOT the cookie / hidden input / meta.
- `Cgdm_Id` / `ordMobile` — popup config (per-seller).

## After the fix — re-check the old rows

Rows checked by the buggy build are stuck at 'unknown'. Run
`sql/34_reset_parcel_checks.sql` ONCE (Supabase SQL editor) to reset Jeff's
'unknown' rows back to NULL so the fixed extension re-checks them.
