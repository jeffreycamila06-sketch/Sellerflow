# Build 10 — "Blank to outsiders" — report

Branch `claude/blank-v2` (from main `6f0406d`), commit `dca7f9f`, pushed. **Not merged, not deployed, no SQL.**
(Committed as docs/audits/build10-report.md — docs/ is not part of the build.)

---

## PART A — wording & exposure audit (read-only, nothing changed)

Every row: switched? = **no — text only**. Suggested replacements are proposals for Jeff/chat-Claude to decide.
"(admin)" = only the admin sees it, but the text still ships in the public JS bundle.

### Counts per screen

| Screen / place | (b) reveals how | (a) seller won't understand |
|---|---|---|
| Login / Signup | 3 | 3 |
| Live screen + Connect (TikTok/FB/Shopee/IG) | 9 | 6 |
| Support guide | 1 | 1 |
| Parcel Scan / Pickup Status | 8 | 4 |
| Shipping (7-11 export) | 3 | 6 |
| Products | 0 | 2 |
| Printer settings / Print / Print pattern | 3 | 8 |
| General settings (profile, laptop auto-print, channels) | 2 | 4 |
| Customers / Orders / Receipts | 0 | 4 |
| Legal screen + public pages (/privacy, /terms, /delete-account, landing HTML) | 6 | 3 |
| Admin (admin only, but in bundle) | 9 | 6 |
| Server answers (Network tab) — see also the code table in Part B | 14 | 12 |
| Socket events / redirect codes / route names / headers | 9 | 2 |
| Old app.html (App.tsx, translations.ts) — no longer built | 22 | 18 |
| Chrome extension (operator tool) | 11 | 2 |
| Store binaries / templates / .bat / native-version.json | 8 | 5 |
| Console (F12) | ~45 calls | — |

### (b) REVEALS HOW — highest severity first

#### Store binaries & files anyone can download
| location | current text (en) | problem | suggested (en / fil) |
|---|---|---|---|
| `mobile/www/assets/index-D6ZnYiqt.js` (673 KB, copied into the APK/IPA) | an old full web build: Render host, "supabase" ×84, socket.io, access_token ×48 | (b) unzip the APK and read everything | ship a blank page in `www` only / — |
| `public/native-version.json` (public URL) | `_comment` with build numbers, bridge name `getBuildNumber`, i18n key | (b) | drop `_comment` |
| `public/sellerflow-printer-shortcut.bat` (+ mobile/www copy) | `--kiosk-printing --user-data-dir…`, cache wipe list, `powershell -ExecutionPolicy Bypass` | (b) shows how 1-click print works; antivirus may flag | cannot be hidden in a .bat — Jeff decides |
| `public/templates/myship-import-template.xlsm` | creator = a 7-11 staff member's name; 7-11's own macro v1.4; filename "myship" | (b) | creator "SellerFlowLive"; rename "7-11-order-upload.xlsm" (⚠️ template bytes are sacred — needs its own plan) |
| `mobile/capacitor.config.ts` server.url | `?apk=20260523-dark-mobile` | (b) build tag in URL/analytics | no visible tag |
| index.html / redesign.html line 13 | `<!-- Redesign font families (…) -->` | (b) internal build note | remove comment |

#### Server answers & routes (Network tab)
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| `GET /health/tiktok` (public, no login) | "tiktok-signing", "EULER_API_KEY is not set…", failure rate, last fail reason, memory, connection counts | (b) vendor + signing + internals, open to anyone | "ok" only |
| `GET /` and `/health` (public) | "SellerFlow TikTok Server Running 🚀", `service:"sellerflow-live-server"` | (b) | "ok" |
| POST /connect/tiktok 500 | raw connector/signing `error.message` (e.g. "the request user is not online") | (b) vendor text in a toast | **now code E0** (Part B) — seller words: "Couldn't connect to your live. Please try again." / "Hindi ma-connect ang live mo. Subukan ulit." |
| /connect/tiktok 429 | "TikTok connection is on cooldown after a rate limit…" / "TikTok rate limit reached…" | (b) "rate limit", "cooldown" (toast) | "Too many tries. Please wait {N} minutes, then tap Connect again." / "Sobrang dami ng try. Hintay ng {N} minuto, tapos i-tap ulit ang Connect." |
| requireAuth 500 | "Server auth is not configured" | (b) | **now E148**; "Something went wrong on our side. Please try again later." / "May problema sa amin ngayon. Subukan ulit mamaya." |
| /connect/tiktok 200 | "TikTok LIVE already connected: X" + `reused:true` | (b) connection reuse | "Connected to your TikTok LIVE." / "Naka-connect na ang TikTok LIVE mo." |
| /fb/connect, /fb/live-check, /ig/connect | `fb_code`/`fb_http`/`fb_timeout`/`ig_code` fields | (b) Graph error codes | drop the fields from the answer |
| /fb/receipt/send 502 | `code`, `fb_code:"190/460"` | (b) Graph code/subcode | drop |
| /myship/validate-gm | "bad_gm_shape", "http_<status>", "fetch_failed" (not in the coded route list) | (b) server fetches the 7-11 page; "GM" id | "That shop link doesn't look right. Please copy it again." / "Mukhang mali ang shop link. Kopyahin ulit." |
| /admin/broadcast-translate, /admin/parcel-scan (admin) | "anthropic_http_<n>", "model_refused", "no_json_in_response"… | (b) AI vendor + model | **now codes** (E104…, E0) |
| /admin/parcel-tracking-poll, /admin/product-images-sweep (cron, anyone can call) | "no_service_role", "poll_not_configured", "sweep_not_configured", "already_running" | (b) | kept as words (cron routes, per spec) — "Not available." |
| Route names | /admin/parcel-emap-check (every seller calls it), /myship/validate-gm, /functions/v1/admin-delete-user (seller self-delete), /api/geo, host sellerflow-live-server.onrender.com, /socket.io | (b) name E-Map, 7-11 GM, Supabase, Render | e.g. /api/store-check, /api/shop-check, /api/delete-account |
| Edge fn admin-delete-user self-delete 200 | `deleted:{seller_profiles, customers, live_session_orders, products, …}` | (b) every table name reaches any seller | "Your account was deleted." / "Na-delete na ang account mo." |
| Edge fn (admin) | "orders delete failed: <pg msg>", "auth deleteUser failed after retries…" | (b) | "Couldn't delete this account. Please try again." |
| HTTP header | `X-Powered-By: Express` (no `app.disable`) | (b) framework | remove header (one line, not done — server logic) |
| Socket `platform_status.reason` | "chat_stale", "silent_timeout", "rate_limited"+`nextRetryMs`, "retry_failed", "streamEnd", "feature_gate", "no_token", "auth", "fetch_error", "max_session", "restart", "shutdown", "deauthorized" | (b) health checks, token, restarts | "reconnecting" / "ended" (out of scope for B3 — socket) |
| Socket comment payload | `roomId, sourceUsername, initial, msgId, isBuy, buyerNum, followerCount, accountCreatedAt` | (b) source + buyer-risk inputs | drop roomId/nextRetryMs |
| Socket event `parcel-tracking:job-done` | event name + `job_id, kind` | (b) background job queue | "pickup-status-updated" |
| OAuth redirects (address bar) | `?fb=error&code=bad_state` / `token_exchange` / `read_failed` | (b) | `code=expired` / `code=try_again` |

#### Built JS bundle (dist, after `npm run build` on this branch)
| string | count in dist JS | note |
|---|---|---|
| supabase | 87 | library + our client (unavoidable) |
| posthog | 141 | library |
| onrender.com | 1 | server host (this build had no .env; prod bakes `VITE_SERVER_URL`) |
| localhost:3001 | 1 | dev fallback |
| socket.io | 5 | library |
| myship | 31 / emap 11 / pcsc 1 | 7-11 export flow + store-lookup link |
| sentry 14 / vercel 5 | library bot-lists only |
| RPC names (e.g. list_free_users_status, free_tier_status_for_user, buyer_tag_lookup…) | ~33 | needed to call them |
| table names (customers, products, live_session_orders…) | ~24 | needed for queries |
| `/admin/parcel-emap-check`, `functions/v1`, `admin-delete-user` | 1 / 1 / 2 | route names |
| `SellerFlowPrinter` 18, `__sflInject` 2 | native bridge / preview injector globals |
| **CSS comments** | **99** in main.css (`cssMinify: false`) | dev notes ship as-is, e.g. commit hashes, "fb_polish_v2", "WKWebView auto-zooms" → Jeff decides `cssMinify: true` |
| hard-coded seller/test emails (feature allowlists in printing.ts, parcelCheck.ts, sessionV2.ts, fb.ts, buyerAlert.ts, pinToPrint.ts…) | many | bundle shows test accounts + per-seller gating |
| euler, anthropic, tiktok-live-connector, eshopGuid, tesseract, service_role | **0** | good |
| dev log text (`[initial]`, `STICKER-TIMING`, …) | **0** (was ~45 messages) | Part B1 |

#### Login / Signup
| location | current text (en) | problem | suggested (en / fil) |
|---|---|---|---|
| i18n `rd_login_unavailable` + useAuthSession.ts:124 | "Sign-in is unavailable in this preview (Supabase not configured)." | (b) vendor on the public login page | "Sign-in isn't available right now. Please try again later." / "Hindi pa puwedeng mag-log in ngayon. Subukan ulit mamaya." |
| useAuthSession.ts:161 | "Registration is unavailable (service not configured)." | (b) | "You can't create an account right now. Please try again later." / "Hindi pa pwedeng gumawa ng account ngayon. Subukan ulit mamaya." |
| useAuthSession.ts:179 → Signup | raw database `e.message` | (b) raw DB error | "Your account was created, but setup didn't finish. Please log in and try again." / "Nagawa na ang account mo pero hindi natapos ang setup. Mag-login ka at subukan ulit." |

#### Live screen + Connect
| location | current text (en) | problem | suggested (en / fil) |
|---|---|---|---|
| connect.ts + RedesignApp toast (Android/web) | raw server `j.error`, "Unauthorized", "Server error", "HTTP 4xx", "plan_expired" | (b) raw server words | "Couldn't connect. Make sure you're LIVE, then try again." / "Hindi maka-connect. Siguraduhing naka-LIVE ka, tapos subukan ulit." · plan_expired: "Your plan has ended. Renew to connect again." / "Tapos na ang plan mo. Mag-renew para maka-connect ulit." |
| i18n `rd_cm_footer` | "Live connection runs on the SellerFlow server — only active in the published app, not this preview." | (b) | "Live connect works in the SellerFlowLive app." / "Sa SellerFlowLive app gumagana ang live connect." |
| i18n `rd_cm_cant_reach`; connect.ts/fb.ts fallback | "Can't reach the live server. Check your connection." | (b) "server" | "Can't connect right now. Check your internet and try again." / "Hindi maka-connect ngayon. I-check ang internet mo at subukan ulit." |
| i18n `rd_cm_add_fb`, `rd_cm_fb_id`, `rd_cm_access_token` (unused, still in bundle) | "…Facebook live video ID" / "Access token" | (b) old token method | remove keys |
| i18n `rd_shp_session_label/ph/help/not_live` | "Live session ID" / "Paste your Shopee Live session ID" | (b) | "Your Shopee Live code" / "Live code mo sa Shopee" |
| i18n `rd_shp_preview_note` | "Preview only — Shopee needs Partner credentials to connect." | (b) | "Shopee connect is coming soon." / "Malapit nang magamit ang Shopee connect." |
| shopeePreview.ts:31 (owner preview) | "Preview shop (no live capture)" | (b) | "Sample shop (preview)" |
| ConnectModal → shopee.ts | raw "preview", server `j.error` | (b) | "Couldn't connect your Shopee shop. Please try again." / "Hindi ma-connect ang Shopee shop mo. Subukan ulit." |
| analytics `connect_failed.reason` (Network tab to PostHog) | raw server error text | (b) | send the code only |

#### Support guide
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| i18n `rd_sup_g1_body` (en, fil, zh-TW, bg) | "Facebook needs your Live Video ID and access token…" | (b) old token method, out of date | "Facebook: Connect your Facebook Page once in Settings → Facebook. Go live from that Page, then tap Connect." / "Facebook: I-connect mo minsan ang Facebook Page mo sa Settings → Facebook. Mag-live ka sa Page na 'yon, tapos i-tap ang Connect." |

#### Parcel Scan / Pickup Status
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| i18n `rd_ps2_sub`, `rd_ps2_ai_soon` | "Scan handwritten parcel slips with AI" | (b) method | "Snap handwritten parcel slips — we fill in the details" / "Picturan ang sulat-kamay na parcel slip — kami na ang mag-fill in" |
| i18n `rd_ps2_recheck_q`, `rd_ps2_pending_q`, `rd_ps2_restricted` | "It will be checked against 7-11 again." / "phone restricted" | (b) background 7-11 query | "Check this parcel again?" / "I-check ulit ang parcel na 'to?" · "number can't be used" / "hindi puwede ang number" |
| ParcelScan.tsx:1178 | scan error codes in monospace ("forbidden", "http_500", "image_decode_failed"…) | (b) | "Try a clearer photo of the parcel slip." / "Subukan ang mas malinaw na picture ng parcel slip." |
| ParcelScan.tsx:1268, 1336/1520, 1345, 1319, 1519 | "Save failed / Export failed / Undo failed / Couldn't delete" + raw DB message or step names (load_failed, claim_failed…) | (b) | same sentence with nothing after it / "Hindi na-save / na-export / na-undo / nabura. Subukan ulit." |

#### Shipping
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| Shipping.tsx:140/181/198 | "Save failed: {raw DB message}" | (b) | "Couldn't save this shipping entry. Please try again." / "Hindi na-save ang shipping entry. Subukan ulit." |
| Shipping.tsx:241 | "Export failed: {raw}" | (b) | "Couldn't export. Please try again." / "Hindi na-export. Subukan ulit." |
| Shipping.tsx:254 via shippingXlsmPatch | "…file could not be generated: not a zip (EOCD missing) / sheetData not found…" | (b) how the file is built | "Your entries are marked exported, but the file didn't download. Try again on a computer." / "Na-mark nang exported, pero hindi na-download ang file. Subukan ulit sa computer." |

#### Printer settings / Print
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| printerBridge.ts → PrinterSettings | "Printer bridge failed" / "Open this inside the SellerFlow mobile app to use phone printer scanning." | (b) "bridge" | "Printer didn't respond. Check it's on." / "Hindi sumagot ang printer. Check kung naka-on." |
| printing.ts window.alert | "Native printer failed." + raw native text | (b) | "Couldn't print. Check your printer is on and connected." / "Hindi naka-print. I-check kung naka-on at connected ang printer." |
| i18n `rd_ps_aimo` | "AIMO D520BT (TSPL, 100×60mm)" | (b) printer language | "AIMO D520BT (100×60mm)" |

#### General settings
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| RedesignApp:337/343 → GeneralSettings | raw DB `e.message` / "Not signed in" / "Save failed" | (b) | "Couldn't save your profile. Please try again." / "Hindi na-save ang profile mo. Subukan ulit." |
| tiktokCooldown.ts → ManageChannels | raw DB message, "unavailable" | (b) | "Couldn't save your accounts. Please try again." / "Hindi na-save ang accounts mo. Subukan ulit." |

#### Legal screen + public pages
| location | current text | problem | suggested (en / fil) |
|---|---|---|---|
| public/privacy:52 | "…AI reading of parcel slips, live-stream connection…" | (b) method | "the services that run the app (hosting, storage, analytics, reading the parcel slips you photograph, connecting to your live, 7-ELEVEN shipping)" / "mga serbisyong nagpapatakbo ng app (…)" |
| public/terms (OLD) | "deletes the stored access token", "API changes" | (b) | **fixed in B5** (new Terms) |
| index/redesign/app.html meta description | "…live selling order, buyer, and 1-click printing system." | (a)-ish | "Turn live comments into orders and print in 1 click." / "Gawing order ang comments sa live, print in 1 click." |

#### Admin (admin only, text in bundle)
| location | current text | problem | suggested |
|---|---|---|---|
| Admin.tsx:296–368 + parcelWorkerState.ts | "on duty / DEGRADED / standby / NOT READY (sfl…, myship…, emap…)", "Swap parcel_check_sender_phone…", "worker v… SILENT (laptop asleep / extension stopped?)" | (b) checker machines, partner systems, setting names | "Checker: OK / Needs attention" / "Checker: OK / May problema" |
| i18n `rd_adm_act_setpw`; useAdmin.ts:237 audit log | "Set password (Edge Function)" / "via admin-set-password Edge Function" | (b) | "Set password" / "Password changed by admin" |
| i18n `rd_adm_pm_scan_cost(_hint)` | "API cost per scan … (Sonnet≈0.20, Haiku≈0.05)" | (b) AI vendor models | "Cost per scan" / "Gastos kada scan" |
| edgeError.ts / adminDelete.ts / useAdmin.ts | "Edge Function returned a non-2xx status code…", raw `e.message` | (b) | "{action} failed. Please try again." |
| broadcastTranslate → Admin | "Couldn't translate (no_json_in_response)" | (b) | now shows a code (E130); "Couldn't translate right now. Send in English or try again." |

#### Chrome extension (operator tool — **not minified**, ~608 comment lines, 58 console calls)
| location | current text | problem | suggested |
|---|---|---|---|
| manifest description | "…using your logged-in session." | (b) | "Checks if your parcels' 7-11 store and phone are OK." / "Chine-check kung OK ang 7-11 store at phone ng parcels mo." |
| manifest host_permissions | `http://localhost:5173/*`, Supabase project URL | (b) dev host + DB vendor | drop localhost |
| popup.html/js | "Supabase URL", "Supabase anon key", "賣場 GM id (Cgdm_Id)", "Seller phone (ordMobile)", "Multi-seller mode (dogfood)", "LEADER / STANDBY / Lease not reachable / DEGRADED", "E-Map landed on error.aspx… re-mint", "guid missing" | (b) vendor, 7-11 field names, failover internals | "Connection code", "Your 7-11 shop ID", "Check for all sellers", "Checking now / Waiting — another computer is checking", "7-11 store map logged out — opening it again…" |
| background.js / myship / emap reasons shown in popup | "CheckoutValidation returned HTML…", "eshopGuid not found", "upsert_http_###" | (b) | "7-11 page logged out — log in again" / "Na-logout ang 7-11 page — mag-login ulit" |
| chrome-extension/README.md (travels with the folder) | full how-it-works manual (endpoints, tokens, polling) | (b) | "Install, open the 3 tabs, log in, click Save." |
| background.js:974 console | logs the sender **phone number** | (b) + personal data | mask it |

#### Old app.html (App.tsx / translations.ts) — **no longer built (Part B4)**, rows kept for the record
22 (b) rows (TikTok "Add your sessionid to backend .env", "Page Access Token", TSPL/ESC-POS/TCP labels, "Printer bridge failed", landing admin-tool descriptions, "our Supabase database" privacy text, accountDb errors appending `(publishable:…XXXX)` key tail, Supabase save/delete errors, debug socket log) and 18 (a) rows (Live Video ID, "Cannot reach server", raw errors, `#SF<timestamp>` order numbers, "Automation engine online", "LAN", MAC addresses, …). None of these ship now. Full rows: in the old-app audit output (kept in the session).

### (a) SELLER WON'T UNDERSTAND

#### Live screen / Connect / Receipts
| location | current text | suggested (en / fil) |
|---|---|---|
| i18n `rd_dash_enterprise`, `rd_dash_ent_title`, `rd_lss_sp_text` | "Enterprise" | "Type price" / "I-type ang presyo" |
| i18n `rd_dash_risk_risky` | "New account (<7d) with no followers" | "New account (under 7 days) with no followers" / "Bagong account (wala pang 7 araw), walang followers" |
| i18n `rd_dash_inject_title` (preview) | "inject a synthetic test comment" | "Add a practice comment" / "Magdagdag ng practice comment" |
| i18n `rd_ba_near_line`, `rd_ba_at_store`, `rd_ba_picked_up` | **en column holds Tagalog** ("Nasa 7-11"…) | "Parcel at 7-11 {store} — {n} days left before it's returned" / "At 7-11" / "Picked up (7 days)" |
| fb.ts:204, ig.ts:136, fbReceipt.ts:94 (polish off) | "Couldn't connect (FB 190)" / "(IG {code})" / "failed (FB 10/2018278)" | "Couldn't connect. Please reconnect your Page." / "Hindi maka-connect. I-reconnect ang Page mo." |
| i18n `rd_print_native_failed` | "Native printer failed." | "Couldn't print — check your printer is on and connected." / "Hindi nag-print — i-check kung naka-on at connected ang printer." |
| i18n `rd_ord_save_failed`, `rd_prd_sync_failed`, `rd_auto_stock_failed` | "the cloud save failed" / "cloud sync failed" | "Saved on this phone only — it didn't go online. Check your connection." / "Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet." |
| useAuthSession.ts:130 → Login | raw "Invalid login credentials" / "Failed to fetch" | "Wrong email or password." / "Mali ang email o password." |
| useAuthSession.ts:165/251 → Signup | English-only error sentences | translate (fil: "May account na ang email na ito. Mag-login ka na lang.") |
| Server: "plan_expired", "no_profile", "too_many_requests", "Unauthorized", "forbidden", "fb_not_available", "*_start_failed", "page_id required", "*_not_found", "needs_reauth", receipt/sold-out reasons, "bad_store_id", "rate_limited" | raw codes where a screen shows them | see server table rows above (now codes in the Network tab; screens unchanged) |

#### Shipping + Support guide g5
| location | current text | suggested (en / fil) |
|---|---|---|
| `rd_shp_err_total_high` | "…(split into bags — coming in P3)" | "Order + fee must not go over NT$20,000 — split into bags." / "Hindi puwedeng lumagpas sa NT$20,000 ang order + fee — hatiin sa ilang bag." |
| `rd_shp_temp` | "Temperature layer" | "Shipping temperature" / "Klase ng padala (normal o frozen)" |
| `rd_shp_export`, `rd_shp_export_browser` | "Export .xlsm ({n})" | "Export 7-11 file ({n})" / "I-export ang 7-11 file ({n})" |
| `rd_shp_max_rows`, `rd_shp_split_must`, `rd_shp_free_rule_hint` | "rows", "cap" | "Max {max} buyers per file…" / "Hanggang {max} buyer lang kada file" |
| `rd_shp_save_failed`, `_export_failed`, `_dl_failed` | raw "{err}" (and a bare "?") | "Couldn't save — check your connection and try again." / "Hindi na-save — i-check ang internet at subukan ulit." |
| `rd_sup_g5_body` | English text in all 7 languages | translate |
| note | `rd_shp_export_ok` says myship2.7-11.com.tw, guide says myship.7-11.com.tw | pick one |

#### Products
| `rd_prd_sku`, `rd_prd_search` | "SKU" | "Item code" / "Item code" |
|---|---|---|
| `rd_prd_pic_too_big`, `rd_rs_too_big` | "(over 400 KB even after shrinking)" / "(over 3 MB)" | "This picture is too big. Pick a smaller one." / "Masyadong malaki ang picture. Pumili ng mas maliit." |

#### Printer settings / Print / Print pattern
| location | current text | suggested (en / fil) |
|---|---|---|
| `rd_pr_sent` (+ Print.tsx) | "Sent to printer ({via})" — via = native-slip/bluetooth/lan/browser | "Sent to printer." / "Naipadala na sa printer." |
| `rd_pp_approx`, `rd_ps_classic_text(_desc)` | "text mode", "built-in fonts instead of the new image mode" | "Simple print — turn ON only if stickers come out blank or wrong." / "Simple print — i-ON lang kung blangko o mali ang sticker." |
| `rd_wg_2`, `rd_wg_3`, `rd_ps_ip`, `rd_ps_port` | "IP address", "port (usually 9100)" | "Print the printer's test page — it shows the printer's number (like 192.168.x.x)." / "I-print ang test page ng printer — nandoon ang number nito." |
| `rd_set_prn_wifi`, `rd_l2_d1_l1`, `rd_l2_b3_d`, `rd_l2_faq_a3`, `rd_l2_g2_d` | "WiFi / LAN receipt printer" | "WiFi receipt printer" |
| `rd_ps_web_driver_size` | "follows your printer driver" | "Set your label size in your computer's printer settings — we fit one label." |
| PrinterSettings.tsx:83,88 | raw native Bluetooth message (English) | "Printer saved." / "Na-save ang printer." |
| PrintPattern.tsx:172–181 | sample "Session…", "Buyer 12", "Comment" untranslated | translate ("Komento") |

#### General settings / Customers / misc
| location | current text | suggested (en / fil) |
|---|---|---|
| `rd_wp_kiosk_body`, `rd_wp_setup_*`, `rd_wp_cmd_*` | "--kiosk-printing", "--user-data-dir", "open Terminal and run {cmd}" | "Tap Copy, then follow the steps to open the silent-print Chrome window." / "I-tap ang Copy, tapos sundan ang steps para buksan ang silent-print na Chrome." |
| `rd_ch_id_tiktok`, `rd_ch_pop_body_tt`, `rd_fb_page_id`, `rd_shp_shop_id` | "ID TikTok" / "Page ID" / "Shop ID" | "TikTok username" / "Page" / "Shop" |
| `rd_rc_so_hint` | "{code} becomes the code" | "Write {code} where you want the code to appear." / "Isulat ang {code} kung saan mo gustong lumabas ang code." |
| `rd_exp_loaded_note` | "Export covers the loaded rows only" | "Export includes only the customers shown — tap Load more first for all." |
| `rd_ps2_orphan_title` | "…were claimed for export…" | "{n} parcels started exporting at {time}, but we don't know if the file was uploaded" |
| `rd_pt_sync_empty` | "No 訂單匯入 rows in this file." | "No parcels found in this file — use the 匯出報表 file." |
| `lg_keep_p`; public/privacy:55 | "A buyer's Messenger ID: 90 days" | "The buyer's Messenger contact: 90 days" / "Messenger contact ng buyer: 90 araw" |
| public/delete-account:41; edge guards.ts:73 | "Master plan accounts can't be deleted…" / "Master accounts can't self-delete" | "This account can't be deleted in the app. Message us and we'll do it." / "Hindi ma-delete sa app ang account na ito. I-message mo kami, kami na bahala." |
| GeneralSettings profile card | "Pro plan · renews Jul 28" (English, US date) | translate |
| RedesignApp:2150, SoonBadge, Orders aria "clear", Landing footer "Terms" | untranslated | translate |
| Info.plist NSLocalNetworkUsageDescription | "local network access… print jobs… thermal" | "SellerFlow needs this to print on your WiFi printer." |
| app name | "SellerFlow" (binaries) vs "SellerFlowLive" (web) | one name |
| server/fbSoldout.js | sold-out default only for en/fil/zh/zh-TW; vi/th/id/bg buyers get English | add texts |
| Admin (admin) | "Sample data — not wired yet", "predate outcome tracking", Exports-per-seller block untranslated, "✗ {label} failed: {err}" | see audit |
| note | `rd_cm_tt_ph` example "duonglily_0708" may be a real seller's handle | swap for a made-up name |

### Production console.* (before → after)
Before: ~94 calls, incl. buyer handles + comment text (RedesignApp auto-skip, useLiveFeed initial), whole order/customer objects (db.ts), RPC names, "[STICKER-TIMING]", "[FB] connect failed code=…". **After Part B1: 0 in the production bundle** except the banner (check-dist proves 75 distinct dev messages absent).

### Server response codes visible in the Network tab
Before: the words above. **After Part B3:** on /fb, /connect, /shopee, /ig, /parcel*, /admin the `error`/`reason` fields are codes — table below.

---

## PART B — built

### Files
| file | lines | what |
|---|---|---|
| `src/lib/log.ts` (new) | 1–23 | `makeLogger(enabled, sink)`; `log` = no-op when `!import.meta.env.DEV` |
| `src/lib/logPure.ts` (new) | 1–3 | `LOG_PURE_NAMES` (log.* / devLog.*) for the build |
| 22 source files | each former console line | 94 `console.*` → `log.*` (App.tsx + accountDb.ts use `log as devLog`); RedesignApp:1422 callback given a block body so the build can strip it |
| `src/redesign/main.tsx` | 11–14 | `CONSOLE_BANNER` — the one production console line (2 lines) |
| `vite.config.ts` | 3, 10–13, 17–21 | `build.sourcemap: false`, `treeshake.manualPureFunctions: LOG_PURE_NAMES`, input = main + redesign only (restore note inline) |
| `scripts/check-dist.mjs` (new) | 1–72 | fails on *.map, sourceMappingURL, dist/app.html, any dev log text, missing marker label, missing banner |
| `package.json` | 9 | `"check:dist"` |
| `.github/workflows/ci.yml` | 20 | `npm run check:dist` right after `npm run build` |
| `src/lib/errCodes.js` (new) | 1–83 | shared word↔code table (app-read words only) + `decodeErr` / `decodeServerJson` |
| `server/errorCodes.js` (new) | 1–66 | server-only codes, `encodeErr`, `opaqueErrors()` middleware, prefixes + skip list |
| `server.js` | 32, 140–141 | import + `app.use(opaqueErrors())` before every route |
| 9 adapters (connect, fb, fbAccess, fbReceipt, fbSoldout, ig, shopee, parcelScan, broadcastTranslate) | each `r.json()` line | `decodeServerJson(await r.json()…)` — nothing else changed |
| `public/terms/index.html` | body | new Terms (~330 words, 9 sections) |
| `src/redesign/screens/Legal.tsx` | 27–28 | "Terms of Service ›" link → `/terms/` |
| `src/redesign/i18n/index.tsx` | 54, 974 | `lg_terms_link` ×8; one marker label (key and value in the chat report only) |
| `CLAUDE.md` | 25–26 | one-line app.html restore note |
| tests | `src/lib/__tests__/errCodes.test.ts` (177), `src/lib/__tests__/blankToOutsiders.test.tsx` (140), `privacyPolicy.test.ts` (terms pin updated) | |

### Code → word → seller text (app behaviour identical: the app decodes the code back to the same word before any check)
| code | word | where the app uses it |
|---|---|---|
| E1 | Unauthorized | connect/fb/shopee 401 fallback |
| E2 | forbidden | admin scan/translate/shipping checks |
| E3 | plan_expired | iOS expired popup, connect toasts |
| E4 | no_profile | — |
| E5 | too_many_requests | `rd_fb_too_many` |
| E6 | account_limit | plan-cap text |
| E7 | account_not_covered | "only your oldest accounts" text |
| E8 | not_live | `rd_fb_not_live` / `rd_ig_not_live` / Shopee not-live |
| E9 | needs_reauth | `rd_fb_reauth_toast` / `rd_ig_reauth_toast` / receipt |
| E10 | page_not_found | `rd_fb_reauth_toast` |
| E11 | account_not_found | `rd_ig_reauth_toast` |
| E12 | no_pages | FB pages empty |
| E13 | token_exchange | FB OAuth |
| E14 | exception | FB |
| E15 | busy | receipt "still sending" |
| E16 | mixed_buyer | receipt mixed-buyer text |
| E17 | needs_messaging | receipt "allow messages" |
| E18 | no_access | receipt access |
| E19 | no_orders | receipt |
| E20 | none_left | receipt "already sent" |
| E21 | send_failed | receipt failed |
| E22 | unknown_result | receipt unknown |
| E23 | server_error | — |
| E24 | empty | broadcast "type a message" |
| E25 | empty_image | parcel scan |
| E26–E34 | disabled, partial, claim_failed, scan_failed, idle, inactive, disconnect, live_session_ended, no_token | app-read words (kept identical) |
| E35–E40 | the six TikTok-connect sentences ("Account is not live right now…", "Facebook page is required", "Seller account is required…", "…already starting…", "TikTok username is required", "…another device…") | shown as-is in the connect toast |
| E41:{n} | "TikTok connection is on cooldown after a rate limit. Try again in {n} minutes." | toast (number kept) |
| E42:{x} | "TikTok rate limit reached. Try again in about {x}." | toast |
| E101–E154 | server-only words (anthropic_*, *_start_failed, fb_check_failed, try_later, insufficient_credits, "Server auth is not configured", …) | the app never compared these — the screen shows its own generic text |
| E0 | anything made up on the spot (raw vendor/exception text, http_NNN, network_error:…) | the screen shows its own generic text; the real text is in the Render log as `[ERR] <method> <path> <status> error=E0 <text>` |

- Kept as words (per spec): `/admin/parcel-tracking-poll`, `/admin/product-images-sweep` (cron), `/fb/deauthorize` (Meta). The extension calls Supabase directly, never these routes. Routes outside the list (`/myship/validate-gm`, `/disconnect/tiktok`, `/health*`) unchanged.
- Tests pin: every code, the exact table (renumbering = red), templates, 401/403/409/429/402/502/500/200 statuses unchanged on a real express app, skip routes, log-only text, `fbConnectFailText`/`igConnectFailText` give the same seller text before/after, every adapter that fetches the server decodes.
- Old app + new server, or new app + old server: both work (old words pass through `decodeServerJson` unchanged).

### Checks
- No raw `console.*` in `src` outside `src/lib/log.ts` (uses an injected sink) and the banner — test-pinned.
- dist: **0 `.map` files, 0 `sourceMappingURL`, no `app.html`, 75/75 dev log messages absent, banner + marker present** (`npm run check:dist` ok; it caught one leaked log line during the build, now fixed).
- `node --check` server.js + server/*.js ✅ · `npm run -s typecheck` ✅ · **full vitest 426 files / 4969 tests passed** · `npm run build` ✅ · lint **63 problems (57 errors, 6 warnings) = main**.
- Sabotage (10 breaks, all red): logger always on, one adapter not decoding, middleware not mounted, a stray console.warn, sourcemap true, Meta route coded, a code renumbered, log line removed, Terms missing "competing product", Legal link pointing elsewhere.

### app.html
Nothing loads `/app.html`: no reference in the Android/iOS projects, the extension, vercel.json or any link — only comments (server.js:468, main.tsx, one contract-test comment, CLAUDE.md). Source files kept; restore = add `app: 'app.html'` back to `build.rollupOptions.input`. **Nothing for Jeff to decide here.**

### For Jeff to decide
1. **Render deploy required** for the server error codes (server.js + server/errorCodes.js). Order is free: the app reads both words and codes. Quiet window + "nobody live" check as usual.
2. `mobile/www` stale full web bundle inside the APK/IPA (biggest exposure found) — needs a binary rebuild.
3. `/health/tiktok`, `/`, `/health` public details; `X-Powered-By` header; socket reasons/fields; OAuth redirect codes; route names — all server logic, out of this build.
4. `cssMinify: false` ships 99 dev comments in CSS.
5. Hard-coded seller/test emails in the bundle (feature allowlists) → move to the DB.
6. Wording (Part A) — every row is text only.
7. Extension: plain, unminified, README + comments describe everything; it logs the sender phone number.
8. `/disconnect/tiktok` was re-added on purpose by Build 1 (fb_connect_v2, platform switch only) — CLAUDE.md corrected.

### Deviations
- Terms "Connected accounts" says "we then delete the access we kept for it" (no "access token" wording); its test pin was updated.
- Follow-up commit: no seller ever sees a code or the server's own words. TikTok connect (toast + Connect modal) shows "Couldn't connect. Try again." (new key `rd_cm_conn_try_again`, 8 languages) unless it is "not live" / "can't reach"; Shopee connect shows `rd_shp_connect_failed`; Parcel Scan shows "scan_failed" under its headline; admin translate shows its "error" fallback. Test `src/redesign/screens/__tests__/noServerCodeShown.test.tsx` runs every code × status through the real adapters and screens.
