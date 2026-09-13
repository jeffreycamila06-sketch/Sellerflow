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

## One-time setup (popup)

1. Open a **SellerFlowLive** tab and log in (keep it open).
2. Open a **myship.7-11.com.tw** tab and log in (keep it open).
3. Click the extension icon → **Parcel checker** section, fill in:
   - **Supabase URL** — prefilled (`https://sqeuyuktdpidmlfpqgoc.supabase.co`).
   - **Supabase anon key** — the *public* key the web app already uses. Get it
     from the SellerFlowLive tab: DevTools → Network → any `…supabase.co/rest/…`
     request → Request Headers → copy the `apikey` value. (It's public/anon — safe.)
   - **賣場 GM id (Cgdm_Id)** — your 賣貨便 shop GM id (e.g. `GM2609096130694`).
   - **Seller phone (ordMobile)** — your own phone used as the sender.
4. **Save config.** The checker polls every 45s while both tabs are open.
   **Pause/Resume** and **Check now** are in the popup.

## How it works (files)

- **`background.js`** (appended section) — a `chrome.alarms` poll (45s): reads your
  access token from the SFL tab (via the bridge), `GET`s up to 5 unchecked rows
  from `parcel_scans` (own-scoped RLS), sends each to the 賣貨便 tab (2s apart,
  single-flight), and `PATCH`es the verdict back. Never persists its own session.
- **`sellerflow-bridge.js`** — now also answers `SFL_GET_TOKEN` by reading
  `localStorage["sf_supabase_auth"]` (the token the web app already keeps fresh).
- **`myship-711.js`** (new, on `myship.7-11.com.tw`) — runs the two checks
  same-origin (cookies attach automatically):
  - **Full store:** `POST /ecmap/byIDData.aspx` → field 3 `enable`→open / `disable`→full.
    Needs `eshopGuid` (server-injected on default.aspx) — read by regex of the page
    HTML first, then a MAIN-world script fallback.
  - **Restricted phone:** `POST /CPF3101/CheckoutValidation/` (validation only) →
    `Status:true`→ok, `false`→restricted (+ the 預計…年月日 date). Needs the CSRF
    `verificationtoken` (hidden input / meta / page var) + Cgdm_Id + ordMobile.

## FAIL-SAFE

On **any** doubt — no token, no tab, expired session (HTML/redirect), bad shape,
network error, 10s timeout, or a page value it can't find — it writes **`unknown`**,
never `ok`/`open`. An unconfirmed parcel is never made to look clean. `unknown` is
a real "tried, couldn't"; only `NULL` means "not yet tried".

## ⚠️ If a check always returns `unknown`

The three page-derived values differ per 賣貨便 build. Verify in the myship tab's
DevTools console what these actually are, then the extraction may need tuning:
- `eshopGuid` — `typeof eshopGuid` / search the page source for `eshopGuid`.
- `verificationtoken` — look for `input[name="__RequestVerificationToken"]`, a
  `<meta>` csrf tag, or a JS var.
- `Cgdm_Id` / `ordMobile` — set from the popup config (per-seller).
