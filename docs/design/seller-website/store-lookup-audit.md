# Store pick — audit of the existing store lookup + proposal (Seller Website Phase 1)

## What exists today (Parcel Scan)

| Carrier | Code | Server route | Who may call it | Source it asks | What it answers |
|---|---|---|---|---|---|
| 7-11 | `server/emapCheck.js` | `POST /admin/parcel-emap-check` | signed-in seller with an active plan (`requireAuth` + `requirePlanActive`), per-seller limit | 7-11 public `EMapSDK.aspx` | `valid` / `not_found` / `unknown` + store name + address |
| FamilyMart | `server/fmStoreCheck.js` | `POST /admin/fm-store-check` | same (`requireAuth` + `requirePlanActive`), 120 / min per seller, 12 h cache, canary store | FamilyMart public store map (`mfme.map.com.tw`) | `valid` / `not_found` / `unknown` (+ "closed type" logged only) |
| 7-11 full / restricted | Chrome extension on the owner's checker laptops | — | admin machines only | 7-11 E-Map / myship pages with a logged-in session | full / restricted verdicts |

Notes from the code itself:
- Both routes need a **seller's login**. A website buyer has no login, so they cannot be used from the shop as they are.
- `emapCheck.js` says its request shape is "documented, not measured" (the sandbox could not reach 7-11), and `fmStoreCheck.js` was measured in a browser, not from Render. Both answer `unknown` on any doubt.
- Every lookup goes out from the **one shared Render IP**. If 7-11 or FamilyMart ever limits that IP, the Parcel Scan checks of every seller stop.

## Proposal

**Phase 1 (built):** the buyer types the 6-digit store number (+ the store name, optional), with a link to the
official map to find it (7-11 `https://emap.pcsc.com.tw/`, FamilyMart `https://www.family.com.tw/Marketing/zh/Map`)
and their last 3 stores on this device. No store verdict is shown (no "checked / full / closed").
The server only checks the number is 6 digits. The seller still sees a wrong number at encoding time,
through the existing Parcel Scan check.

**Why not open the existing routes to buyers now:** an anonymous public route that makes the server call
7-11 / FamilyMart is an open relay — anyone could spend the shared IP's goodwill and break the sellers'
Parcel Scan checks. It also returns `unknown` often until the shapes are measured from Render.

**Phase 2 (safest option, not built):** a new public route, e.g. `POST /shop/store-name`, on Render:
- only for a shop that is online (`website_shop` rule);
- reuses the cached results first (FamilyMart already keeps 12 h; add the same for 7-11);
- tight limits per IP and per shop (e.g. 10 / min per IP, 200 / hour per shop), separate from the sellers' limits;
- returns **only the store name** for a valid number, nothing else — never full / closed;
- the shop shows "Xinyi store ✓" next to the number; `unknown` shows nothing (the buyer can still order).
Needs a Render deploy and the first real lookups measured from Render before it is turned on.
