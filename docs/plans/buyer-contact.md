# Buyer contact picker + Pickup Status contact buttons — plan v1 (planner draft, for audit)

Base: origin/main c9010d8. NOTE: sql/138 and sql/139 are RESERVED by the pending TikTok API branches
(claude/tiktok-connect = sql/138_tiktok_business; TikTok post sales = sql/139). This feature uses sql/140.

## Owner-approved UI (do not change)
- Parcel Scan manual/confirm/edit header: "Manual entry" + [Scan QR] [Customers] on the right (Scan QR moved up from the handle row; Customers stays manual-only).
- "Buyer contact" label + ONE row of small round icons on the same line: TikTok (official small logo; mockup used "T"), LINE, WhatsApp, Facebook, Instagram, Other (…). Selected = ring, others dimmed. 34–36 px; drop to 32 px rather than wrap at 390 px.
- One input below with the platform tag inside + per-platform placeholder/hint (TikTok @username — Scan QR fills it and selects TikTok; LINE "LINE ID (not phone)"; WhatsApp +886 912 345 678; Facebook name or profile link; Instagram @username; Other free text). Checkbox "Buyer has no contact". Default TikTok.
- Pickup Status: contact chip + one-tap button per platform (WhatsApp opens chat with message ready; LINE/FB/IG/TikTok open profile/chat + message copied; Other = copy).
- Previews at iPhone 390, Android 412, computer 1280 (real app screens, light + dark).

## Data model (option B — new column, col J unchanged)
sql/140_buyer_contact.sql (+ rollback): contact_platform text null (check in tiktok/line/whatsapp/facebook/instagram/other) on parcel_scans, parcel_customers, fm_parcel_scans, fm_parcel_customers; recreate upsert_parcel_customer() (body sql/36:43-87) and upsert_fm_parcel_customer() (sql/121:51-83) carrying contact_platform (replaced together with the handle; a blank handle keeps the old platform); trigger column lists += contact_platform; app_settings buyer_contact_enabled='false'; my_feature_access() = latest key list + 'buyer_contact'. NULL = TikTok/legacy.
Col J / FM product cell / scanToXlsRow / fmScanCells untouched → 賣貨便 export, 匯出報表 sync, Chrome extension, poller, Buyer Alert, sticker QR unchanged.

## Files
- NEW adapters/buyerContact.ts: BUYER_CONTACT_PLATFORMS, normalizeContact, contactError, contactLink → {open url}|{copy}, pickupMessage, buyerContactVisible({role,plan,switchOn,previewKey}) = admin OR feature key OR (switch on AND plan in plus/pro/master — PARCEL_TRACKING_TIERS).
- NEW components/BuyerContactField.tsx (shared picker; reuse FB/LINE SVGs from ContactChip.tsx:20-24).
- adapters/parcelScan.ts: ScanFormState :289 platform; formErrors :327 WhatsApp only; rowToScan :380 spread when non-null; SCANS_COLS :399; saveParcelScan :460 / updateParcelScan :847 optional contactPlatform (spread only when passed). Do NOT touch scanToXlsRow :545.
- screens/ParcelScan.tsx: header :1276-1284 Scan QR moved; handle block :1325-1353 → BuyerContactField only when visible, else current block byte-identical; onScanQr :1029 selects tiktok; edit prefill :957 and saves :624/:648/:662/:963 pass platform.
- adapters/parcelCustomers.ts SELECT_COLS :48 + updateParcelCustomer :109; screens/CustomerDetails.tsx import :61/:145, edit :69 → picker; Customers fill restores platform.
- adapters/parcelTracking.ts: loadBuyerContacts(handles) → Map<normHandle, platform> (own parcel_scans last 60 days, newest wins, paged 500 max 2000; fallback parcel_customers; + fm_parcel_scans / fm_parcel_customers); only when visible; PT_SELECT :429 untouched.
- screens/ParcelTracking.tsx: Buyer :155 contact chip; ChaseAction :120 platform branch — NULL/tiktok = today's code exactly + separate Copy message when visible; load map next to names :428-432.
- FM: FmParcelScan.tsx :309-325 + save :119; fmScan.ts COLS :196 insert :223; fmCustomers.ts :40; FmCustomerDetails.tsx :235.
- featureSwitches.ts :7 buyerContact; featureAccess.ts :11 buyer_contact.

## Links (real <a href target=_blank rel="noreferrer noopener">; copy message in onClick first)
- WhatsApp: digits only, strip 00; TW 09xxxxxxxx → +886, PH 09xxxxxxxxx → +63 (shown); 8–15 digits else Save blocked. https://wa.me/<digits>?text=<encoded msg>.
- LINE: trim, lowercase, strip @, [a-z0-9._-]{4,20}; all digits → hint. https://line.me/R/ti/p/~<id> + copy (opens add friend; device-test).
- Facebook: URL on facebook.com/m.facebook.com/fb.com or username [A-Za-z0-9.]{5,50}; username → https://m.me/<u>; profile.php?id= → profile URL; names/15+ digit ids → copy only.
- Instagram: strip @, [A-Za-z0-9._]{1,30}; https://ig.me/m/<u> + copy (device-test).
- TikTok: unchanged chaseTarget + separate Copy message.
- Other: copy message + copy contact.
Message: name (Customer Details name else recipientName), carrier (7-11/全家), store (recStore or storeId), amount formatPrice(orderAmount), pick-up-by pickupDeadline; seller UI language; template editing = v2.

## i18n (8 langs, seller-level words)
rd_bc_label, rd_bc_no_contact, rd_bc_ph_{6}, rd_bc_hint_line, rd_bc_hint_whatsapp, rd_bc_err_whatsapp, rd_bc_name_{6}, rd_pt_open_{whatsapp,line,facebook,instagram}, rd_pt_copy_msg, rd_pt_msg_copied, rd_pt_msg_tpl. rd_ps2_no_handle stays for feature-off.

## Tests
- buyerContact.test.ts: normalize/validate, URL table incl. & # emoji CJK encoding, copy-only cases.
- PERMANENT buyerContact.legacy.test.tsx: switch off → ParcelScan/FmParcelScan/CustomerDetails DOM = today; save payloads have no contact_platform key; scanToXlsRow + fmScanCells byte-identical fixture; Pickup ChaseAction NULL/tiktok = today.
- scripts/sql140-behaviour.mjs (pglite): trigger carries platform, replaced with handle, blank keeps old, check constraint, rollback.
- Gate matrix: admin, preview key, plus/pro/master × switch, basic/free off.
- Existing suites: parcelScan, parcelTracking, fm*, CustomerDetails, parcelExportRead, typecheck.

## Rollout
1. Apply sql/140 (chat-Claude via MCP) and verify. 2. Deploy, switch OFF. 3. Preview key for Jeff + googletest; real-device test (iOS/Android shell: each link opens the right app; clipboard filled before switching). 4. FM under same key. 5. Flip buyer_contact_enabled → Plus/Pro/Master.

## Estimate
~8–11 Claude Code hours (+ Jeff's device test).

---
# v2 — REQUIRED CHANGES from the independent plan audit (these override v1 where they differ)
Line refs corrected: upsert_parcel_customer body = sql/36:44-88; FM function body = sql/121:51-78 (:79-84 grant/trigger).

1. my_feature_access(): build sql/140's version from the LIVE `pg_get_functiondef` at apply time (chat-Claude applies it), keeping every existing key + 'buyer_contact', and 'tiktok_api' if sql/138 is applied. Header comment says so. Apply check: `my_feature_access()` contains 'buyer_contact' (and 'tiktok_api' when 138 applied). Leave a note in docs/plans/tiktok-api.md that 138/139 must keep 'buyer_contact'.
2. No stranger's TikTok: save WhatsApp in col J as `+<digits>` (the "+" already routes chaseTarget to Copy). Load the contact map whenever Pickup Status is visible (not only when the feature is on); a row whose platform is known and not TikTok never gets TikTok Open. When the map is missing/capped/failed, a value that looks like a phone number (8–15 digits, optional +) never gets TikTok Open. Tests for each case.
3. Lookup precision: match handle + store_id first (parcel_tracking and the scan tables both have it), then handle only. carrier='fm' rows read FM tables first, 7-11 rows the 7-11 tables. Use normHandle from parcelTracking.ts:390 (not buyerAlert.ts:41).
4. Message name: Customer Details name, else NO name (never parcel_tracking.recipient_name — it is masked like J*f*r*y). If a name contains "*", use the no-name greeting.
5. 50-char col J limit: on save shorten Facebook URLs to the username or `fb:<id>`; contactLink rebuilds the URL. Test: saved value never > 50.
6. Switch off = identical screen: gate the Scan QR header move with the same buyerContactVisible; the legacy DOM test covers manual, scan-confirm and edit modes.
7. Stale platform on edit: when the handle changes and the row has a platform, send contact_platform: null (rows that are NULL keep a payload with no new key). Same for updateParcelCustomer.
8. Gate = who can use Parcel Scan + paid tier: buyerContactVisible uses isAdminRole, lower(trim(plan)) and the tracking tiers like parcelTracking.ts:26-36, plus marketHidden. parcel_check-list sellers on basic/free do NOT get the picker (state this in the report).
9. Defaults: in continuous scan/manual mode the platform STAYS on the last chosen one after each save (sellers usually encode a batch from the same app); "Buyer has no contact" ticked → platform saved as NULL. Test both.
10. Help guide + support-bot FAQ entries, user-level words only (what the seller can do, nothing about how it works inside), 8 languages; regenerate sql/116b (applied after merge).
Optional (do them): privacy page "What we collect" adds "buyer contact (phone number or messaging ID) you record" (public/privacy/index.html:33-38); save NULL instead of 'tiktok'; BUYER_CONTACTS_MAX like BUYER_NAMES_MAX with a one-time log at the cap.

Estimate (audited): ~13–16 Claude Code hours + Jeff's device test.
