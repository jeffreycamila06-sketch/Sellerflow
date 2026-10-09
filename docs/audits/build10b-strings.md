# Build 10b — every changed seller string (en / fil)

The other 6 languages carry the same meaning (see src/redesign/i18n/index.tsx).

## 1. Changed / added strings

| key or file:line | new en | new fil |
|---|---|---|
| `lg_keep_p` | Live comments: 10 days. Order history: 3 months. Messenger receipt pictures: 24 hours. Receipt records: 3 months. Parcel status: 7 days after pickup, 365 days after return. Your account, customer list and settings: until you delete your account. The buyer's Messenger contact: 90 days. Waiting list: 10 days. | Live comments: 10 araw. Kasaysayan ng order: 3 buwan. Mga larawan ng Messenger receipt: 24 oras. Mga record ng resibo: 3 buwan. Status ng parcel: 7 araw pagkakuha, 365 araw pagkabalik. Ang iyong account, listahan ng customer at settings: hanggang burahin mo ang iyong account. Messenger contact ng buyer: 90 araw. Pila ng naghihintay: 10 araw. |
| `rd_adm_act_setpw` | Set password | Itakda ang password |
| `rd_adm_exp_h_7d` (NEW) | 7 days | 7 araw |
| `rd_adm_exp_h_last` (NEW) | Last month | Nakaraang buwan |
| `rd_adm_exp_h_lastexp` (NEW) | Last export | Huling export |
| `rd_adm_exp_h_pickup` (NEW) | Pickup | Pickup |
| `rd_adm_exp_h_plan` (NEW) | Plan | Plan |
| `rd_adm_exp_h_seller` (NEW) | Seller | Seller |
| `rd_adm_exp_h_this` (NEW) | This month | Ngayong buwan |
| `rd_adm_exp_line` (NEW) | {plan} · last month {last} · 7d {d7} · last {day} · Pickup {pickup} | {plan} · nakaraang buwan {last} · 7 araw {d7} · huli {day} · Pickup {pickup} |
| `rd_adm_exp_load_err` (NEW) | Couldn't load exports | Hindi ma-load ang exports |
| `rd_adm_exp_no_link` (NEW) | no shop link | walang shop link |
| `rd_adm_exp_none` (NEW) | No exports yet | Wala pang export |
| `rd_adm_exp_summary` (NEW) | This month {a} · Last month {b} · {n} sellers | Ngayong buwan {a} · Nakaraang buwan {b} · {n} seller |
| `rd_adm_exp_title` (NEW) | Exports per seller | Mga export kada seller |
| `rd_adm_failed` | ✗ {label} failed. Please try again. | ✗ Nabigo ang {label}. Subukan ulit. |
| `rd_adm_pm_scan_cost` | Cost per scan | Gastos kada scan |
| `rd_adm_pm_scan_cost_hint` | Adjustable — recomputes cost & profit | Nababago — muling kinukwenta ang cost at profit |
| `rd_adm_pm_untracked_note` | {n} scan(s) this month happened before results were recorded — not counted above. | {n} scan ngayong buwan ay nangyari bago pa naitala ang resulta — hindi kasama sa itaas. |
| `rd_adm_sample_note` | Sample data — not live yet | Sample data — hindi pa live |
| `rd_ann_translate_fail` | Couldn't translate right now. Send in English or try again. | Hindi maisalin ngayon. I-send sa English o subukan ulit. |
| `rd_auto_stock_failed` | Saved on this phone only — it didn't go online. Check your connection. | Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet. |
| `rd_ba_at_store` | At 7-11 | Nasa 7-11 |
| `rd_ba_near_line` | Parcel at 7-11 {store} — {n} days left before it's returned | May parcel sa 7-11 {store} — {n} days na lang bago ma-return |
| `rd_ba_picked_up` | Picked up (7 days) | Nakuha (7 days) |
| `rd_ch_id_tiktok` | TikTok username | TikTok username |
| `rd_ch_pop_body_tt` | To add a TikTok username for LIVE multi-account, please message our admin on Telegram and we'll set it up for you. | Para magdagdag ng TikTok username para sa LIVE multi-account, mag-message sa aming admin sa Telegram at ise-set up namin ito para sa iyo. |
| `rd_cm_cant_reach` | Can't connect right now. Check your internet and try again. | Hindi maka-connect ngayon. I-check ang internet mo at subukan ulit. |
| `rd_cm_conn_try_again` | Couldn't connect. Make sure you're LIVE, then try again. | Hindi maka-connect. Siguraduhing naka-LIVE ka, tapos subukan ulit. |
| `rd_cm_footer` | Live connect works in the SellerFlowLive app. | Sa SellerFlowLive app gumagana ang live connect. |
| `rd_cm_reconnect_page` (NEW) | Couldn't connect. Please reconnect your Page. | Hindi maka-connect. I-reconnect ang Page mo. |
| `rd_cm_tt_cooldown` (NEW) | Too many connects. Wait {n} minutes, then try again. | Masyadong maraming connect. Maghintay ng {n} minuto, tapos subukan ulit. |
| `rd_cm_tt_ph` | e.g. yourshop_live | e.g. yourshop_live |
| `rd_dash_ent_title` | Type price — enter a price, then press Enter to print | I-type ang presyo — ilagay ang presyo, tapos Enter para mag-print |
| `rd_dash_enterprise` | Type price | I-type ang presyo |
| `rd_dash_inject_title` | Add a practice comment | Magdagdag ng practice comment |
| `rd_dash_risk_risky` | New account (under 7 days) with no followers | Bagong account (wala pang 7 araw), walang followers |
| `rd_del_protected` (NEW) | This account can't be deleted in the app. Message us and we'll do it. | Hindi ma-delete sa app ang account na ito. I-message mo kami, kami na bahala. |
| `rd_exp_loaded_note` | Export includes only the customers shown — tap Load more first for all. | Kasama lang sa export ang mga customer na nakikita — i-tap muna ang Load more para sa lahat. |
| `rd_fb_page_id` | Page | Page |
| `rd_l2_b3_d` | Sticker and receipt slips on Bluetooth & WiFi printers — Chinese names included. | Sticker at receipt slips sa Bluetooth at WiFi printers — kasama ang Chinese names. |
| `rd_l2_d1_l1` | Bluetooth sticker printers & WiFi receipt printers | Bluetooth sticker printers at WiFi receipt printers |
| `rd_l2_faq_a3` | Bluetooth thermal sticker printers (like AIMO) and WiFi receipt printers (like Xprinter). Chinese buyer names print correctly. | Bluetooth thermal sticker printers (tulad ng AIMO) at WiFi receipt printers (tulad ng Xprinter). Tama ang print ng Chinese na pangalan. |
| `rd_l2_g2_d` | Pair your Bluetooth sticker printer or WiFi receipt printer. | I-pair ang Bluetooth sticker printer o WiFi receipt printer mo. |
| `rd_login_err_wrong` (NEW) | Wrong email or password. | Mali ang email o password. |
| `rd_login_unavailable` | Sign-in isn't available right now. Please try again later. | Hindi pa puwedeng mag-log in ngayon. Subukan ulit mamaya. |
| `rd_lss_sp_text` | While this is on, every 1-Click and Auto order prints this price, whatever the buyer types. In Type price, the price is pre-filled but you can still change it. | Habang naka-on ito, bawat 1-Click at Auto order ay magpi-print ng presyong ito, kahit ano pa ang i-type ng buyer. Sa I-type ang presyo, naka-pre-fill ang presyo pero puwede mo pa rin itong palitan. |
| `rd_ord_save_failed` | Saved on this phone only — it didn't go online. Check your connection. | Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet. |
| `rd_ord_search_clear` (NEW) | Clear search | I-clear ang search |
| `rd_pp_approx` | Approximate — Simple print is on, so the layout may differ | Tantiya lang — naka-on ang Simple print, kaya maaaring iba ang ayos |
| `rd_pp_sample_buyer` (NEW) | Buyer 12 | Buyer 12 |
| `rd_pp_sample_comment` (NEW) | Comment | Komento |
| `rd_pp_sample_session` (NEW) | Session: | Session: |
| `rd_pr_native_note` | Printing runs in the SellerFlowLive app — open it on your phone to print. | Tumatakbo sa SellerFlowLive app ang pag-print — buksan ito sa iyong telepono para mag-print. |
| `rd_pr_sent` | Sent to printer. | Naipadala na sa printer. |
| `rd_prd_pic_too_big` | This picture is too big. Pick a smaller one. | Masyadong malaki ang picture. Pumili ng mas maliit. |
| `rd_prd_search` | Search name or item code | Maghanap ng pangalan o item code |
| `rd_prd_sku` | Item code | Item code |
| `rd_prd_sync_failed` | Saved on this phone only — it didn't go online. Check your connection. | Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet. |
| `rd_print_native_failed` | Couldn't print — check your printer is on and connected. | Hindi nag-print — i-check kung naka-on at connected ang printer. |
| `rd_ps2_ai_soon` | Snap a parcel slip, we fill in the details — coming soon | Picturan ang parcel slip, kami na ang mag-fill in — malapit na |
| `rd_ps2_delete_err` | Couldn't delete. Please try again. | Hindi nabura. Subukan ulit. |
| `rd_ps2_err_save` | Save failed. Please try again. | Hindi na-save. Subukan ulit. |
| `rd_ps2_orphan_title` | {n} parcels started exporting at {time}, but we don't know if the file was uploaded | {n} parcel ang nagsimulang i-export nang {time}, pero hindi namin alam kung na-upload ang file |
| `rd_ps2_pending_q` | {n} parcel(s) are still being checked. Exported parcels won't be checked anymore. Wait a moment, or export anyway? | {n} parcel ang sinusuri pa. Hindi na susuriin ang mga na-export na parcel. Maghintay sandali, o i-export na rin? |
| `rd_ps2_recheck_q` | Check this parcel again? | I-check ulit ang parcel na 'to? |
| `rd_ps2_restricted` | number can't be used | hindi puwede ang number |
| `rd_ps2_scan_clearer` (NEW) | Try a clearer photo of the parcel slip. | Subukan ang mas malinaw na picture ng parcel slip. |
| `rd_ps2_sub` | Snap handwritten parcel slips — we fill in the details | Picturan ang sulat-kamay na parcel slip — kami na ang mag-fill in |
| `rd_ps2_undo_failed` | Undo failed. Please try again. | Hindi na-undo. Subukan ulit. |
| `rd_ps2_x_failed` | Export failed. Please try again. | Hindi na-export. Subukan ulit. |
| `rd_ps_aimo` | AIMO D520BT (100×60mm) | AIMO D520BT (100×60mm) |
| `rd_ps_bt_saved` | Printer saved. | Na-save ang printer. |
| `rd_ps_classic_text` | Simple print | Simple print |
| `rd_ps_classic_text_desc` | Simple print — turn ON only if stickers come out blank or wrong. | Simple print — i-ON lang kung blangko o mali ang sticker. |
| `rd_ps_ip` | Printer number (from its test page) | Number ng printer (mula sa test page) |
| `rd_ps_native_note` | Printer connection runs in the SellerFlowLive app — these controls work on your phone, not in the web preview. | Tumatakbo sa SellerFlowLive app ang koneksyon ng printer — gumagana ang mga kontrol na ito sa iyong telepono, hindi sa web preview. |
| `rd_ps_open_app_connect` | Open the SellerFlowLive app on your phone to connect a printer. | Buksan ang SellerFlowLive app sa iyong telepono para ikonekta ang printer. |
| `rd_ps_open_app_scan` | Open the SellerFlowLive app on your phone to scan Bluetooth printers. | Buksan ang SellerFlowLive app sa iyong telepono para mag-scan ng Bluetooth printer. |
| `rd_ps_open_app_test` | Open the SellerFlowLive app on your phone to test-print. | Buksan ang SellerFlowLive app sa iyong telepono para mag-test-print. |
| `rd_ps_port` | Second number (usually 9100) | Pangalawang number (kadalasan 9100) |
| `rd_ps_web_driver_size` | Set your label size in your computer's printer settings — we fit one label. | Itakda ang label size sa printer settings ng computer mo — isang label ang ia-akma namin. |
| `rd_pt_sync_empty` | No parcels found in this file — use the 匯出報表 file. | Walang parcel sa file na ito — gamitin ang 匯出報表 file. |
| `rd_rc_so_hint` | Auto mode: when a Facebook buyer comments a code that is already sold out, they get this one private message in Messenger (once per comment). Write {code} where you want the code to appear. | Auto mode: kapag nag-comment ang Facebook buyer ng code na sold out na, matatanggap niya ang isang private message na ito sa Messenger (isang beses kada comment). Isulat ang {code} kung saan mo gustong lumabas ang code. |
| `rd_rs_too_big` | This picture is too big. Shorten the list or the note. | Masyadong malaki ang picture. Paikliin ang listahan o ang paalala. |
| `rd_set_plan_only` (NEW) | {plan} plan | {plan} plan |
| `rd_set_plan_renews` (NEW) | {plan} plan · renews {date} | {plan} plan · magre-renew sa {date} |
| `rd_set_prn_wifi` | WiFi receipt printer | WiFi na resibo printer |
| `rd_set_profile_save_failed` (NEW) | Couldn't save your profile. Please try again. | Hindi na-save ang profile mo. Subukan ulit. |
| `rd_shp_connect_failed` | Couldn't connect your Shopee shop. Please try again. | Hindi ma-connect ang Shopee shop mo. Subukan ulit. |
| `rd_shp_dl_failed` | Your entries are marked exported, but the file didn't download. Try again on a computer. | Na-mark nang exported, pero hindi na-download ang file. Subukan ulit sa computer. |
| `rd_shp_err_total_high` | Order + fee must not go over NT$20,000 — split into bags. | Hindi puwedeng lumagpas sa NT$20,000 ang order + fee — hatiin sa ilang bag. |
| `rd_shp_export` | Export 7-11 file ({n}) | I-export ang 7-11 file ({n}) |
| `rd_shp_export_browser` | Exporting the 7-11 file needs a browser — open sellerflowlive.com on your computer or phone browser. Everything you encoded here is already saved. | Kailangan ng browser para i-export ang 7-11 file — buksan ang sellerflowlive.com sa computer o phone browser mo. Naka-save na ang lahat ng na-encode mo rito. |
| `rd_shp_export_failed` | Couldn't export. Please try again. | Hindi na-export. Subukan ulit. |
| `rd_shp_export_ok` | {n} exported — {file} downloaded. Upload it at myship.7-11.com.tw. | {n} na-export — na-download ang {file}. I-upload ito sa myship.7-11.com.tw. |
| `rd_shp_free_rule_hint` | New entries for buyers totaling {amt} or more start with fee 0. Each bag still needs at least NT$55. | Ang mga bagong entry para sa buyer na umabot ng {amt} pataas ay magsisimula sa fee 0. Kailangan pa rin ng hindi bababa sa NT$55 kada bag. |
| `rd_shp_max_rows` | Max {max} buyers per file — {n} selected. Export in smaller batches. | Hanggang {max} buyer lang kada file — {n} ang napili. I-export nang paunti-unti. |
| `rd_shp_not_live` | Couldn't start — check your Live code and that your Shopee Live is running. | Hindi nagsimula — i-check ang Live code mo at kung naka-live ka sa Shopee. |
| `rd_shp_preview_note` | Shopee connect is coming soon. | Malapit nang magamit ang Shopee connect. |
| `rd_shp_save_failed` | Couldn't save — check your connection and try again. | Hindi na-save — i-check ang internet at subukan ulit. |
| `rd_shp_session_help` | Open your Shopee live page, copy your Live code and paste it here. | Buksan ang Shopee live page mo, kopyahin ang Live code at i-paste dito. |
| `rd_shp_session_label` | Your Shopee Live code | Live code mo sa Shopee |
| `rd_shp_session_ph` | Paste your Shopee Live code | I-paste ang Live code mo sa Shopee |
| `rd_shp_shop_id` | Shop | Shop |
| `rd_shp_split_must` | Over NT$20,000 — 7-11 won't take one bag above that. Split this buyer into bags. | Lagpas NT$20,000 — hindi tatanggapin ng 7-11 ang isang bag na lagpas doon. Hatiin ang buyer na ito sa ilang bag. |
| `rd_shp_temp` | Shipping temperature | Klase ng padala (normal o frozen) |
| `rd_soon` (NEW) | Soon | Malapit na |
| `rd_soon_title` (NEW) | Coming soon — not ready yet | Malapit na — hindi pa handa |
| `rd_su_err` | Could not create your account. Please try again. | Hindi nagawa ang account mo. Subukan ulit. |
| `rd_su_err_exists` (NEW) | That email is already registered. Try logging in. | May account na ang email na ito. Mag-login ka na lang. |
| `rd_su_err_setup` (NEW) | Your account was created, but setup didn't finish. Please log in and try again. | Nagawa na ang account mo pero hindi natapos ang setup. Mag-login ka at subukan ulit. |
| `rd_su_err_unavailable` (NEW) | You can't create an account right now. Please try again later. | Hindi pa pwedeng gumawa ng account ngayon. Subukan ulit mamaya. |
| `rd_sup_g1_body` | First, add your account in Channels: Go to Settings → Channels (or Manage Channels). Type your TikTok username (and Facebook, if you use it), then Save. Your accounts are now saved and ready. ⏎  ⏎ Then connect during your live: ⏎ TikTok: Go live on TikTok first. On the Dashboard, tap Connect on your TikTok account. Once you're live and connected, the dot turns green and your co … (full text in i18n/index.tsx) | Una, idagdag ang account mo sa Channels: Pumunta sa Settings → Channels (o Manage Channels). I-type ang TikTok username mo (at Facebook, kung ginagamit mo), tapos Save. Naka-save na at handa na ang mga account mo. ⏎  ⏎ Tapos kumonekta habang live ka: ⏎ TikTok: Mag-live muna sa TikTok. Sa Dashboard, i-tap ang Connect sa TikTok account mo. Kapag live ka na at nakakonekta, magigin … (full text in i18n/index.tsx) |
| `rd_sup_g5` | How to use: 7-11 shipping export | Paano gamitin: 7-11 shipping export |
| `rd_sup_g5_body` | 1. After your live session, go to Orders → 🚚 Shipping ⏎ 2. Your buyers are automatically grouped by buyer number — one buyer = one bag = one shipping entry ⏎ 3. Tap "Add shipping info" for each buyer and enter: ⏎ • Recipient's REAL NAME (max 10 characters, no numbers or symbols — usernames won't work) ⏎ • Phone number (10 digits, starts with 09) ⏎ • 7-11 store number (6 digits  … (full text in i18n/index.tsx) | 1. Pagkatapos ng live mo, pumunta sa Orders → 🚚 Shipping ⏎ 2. Awtomatikong naka-grupo ang mga buyer ayon sa buyer number — isang buyer = isang bag = isang shipping entry ⏎ 3. I-tap ang "Add shipping info" sa bawat buyer at ilagay: ⏎ • TOTOONG PANGALAN ng tatanggap (hanggang 10 character, walang numero o simbolo — hindi puwede ang username) ⏎ • Phone number (10 digit, nagsisimul … (full text in i18n/index.tsx) |
| `rd_wg_2` | Print the printer's test page — it shows the printer's number (like 192.168.x.x). | I-print ang test page ng printer — nandoon ang number nito. |
| `rd_wg_3` | Enter that number on the next screen. | Ilagay ang number na iyon sa susunod na screen. |
| `rd_wp_cmd_btn` | Copy | Kopyahin |
| `rd_wp_cmd_label` | Silent-print setup | Setup ng silent-print |
| `rd_wp_cmd_mac` | Mac: open the Terminal app, paste this and press Return:  {cmd} | Mac: buksan ang Terminal app, i-paste ito at pindutin ang Return:  {cmd} |
| `rd_wp_kiosk_body` | Go to Settings → Laptop auto-print. Tap Copy, then follow the steps to open the silent-print Chrome window. | Pumunta sa Settings → Laptop auto-print. I-tap ang Copy, tapos sundan ang steps para buksan ang silent-print na Chrome. |
| `rd_wp_setup_body` | Tap Copy, then follow the steps to open the silent-print Chrome window. | I-tap ang Copy, tapos sundan ang steps para buksan ang silent-print na Chrome. |
| `rd_wp_setup_tip` | Tip: use that Chrome window only for printing during your live. | Tip: gamitin lang ang Chrome window na iyon sa pag-print habang live ka. |
| src/redesign/adapters/useAuthSession.ts signIn | Sign-in isn't available right now. Please try again later. / Wrong email or password. / Sign-in failed. Check your details and try again. (+ errorKey → translated on Login; raw auth text never shown) | (via rd_login_* keys) |
| src/redesign/adapters/useAuthSession.ts register | You can't create an account right now. Please try again later. / Your account was created, but setup didn't finish. Please log in and try again. / Could not create your account. Please try again. (+ errorKey; raw DB text never shown) | (via rd_su_* keys) |
| src/redesign/screens/Login.tsx, Signup.tsx | show only the translated errorKey text, never res.error | — |
| src/redesign/adapters/shopeePreview.ts:32 | Sample shop (preview) | (not translated — owner preview only) |
| src/redesign/adapters/printerBridge.ts:43 | Open the SellerFlowLive app on your phone to set up this printer. | — |
| src/redesign/adapters/printerBridge.ts:61 | Printer didn't respond. Check it's on. (raw native text no longer passed) | — |
| src/redesign/adapters/tiktokCooldown.ts touchSlot | Couldn't save your accounts. Please try again. (raw DB text + "unavailable" no longer returned) | — |
| src/redesign/adapters/parcelWorkerState.ts (Admin card) | Checker: OK / Checker: Needs attention / Checker: Needs attention — no signal {n}m ago | — |
| src/redesign/screens/Admin.tsx LeaseLine | " Needs attention" (was DEGRADED); " · ready" / " · Needs attention" (was ready (…)/NOT READY (sfl…, myship…, emap…)) | — |
| src/redesign/screens/Admin.tsx sender check | ⚠️ Checker: Needs attention — the check number {phone} can't be used, so checks are paused. Change it to another number. | — |
| src/redesign/screens/Admin.tsx Exports per seller block | moved to rd_adm_exp_* keys (+ rd_adm_pm_loading, rd_dash_refresh) | (via keys) |
| src/redesign/screens/Admin.tsx rd_adm_failed ×5, translate fail | {err} argument dropped — no raw server text | — |
| src/redesign/adapters/useAdmin.ts:237 audit note | Password changed by admin | — |
| src/redesign/adapters/useAdmin.ts:240 | Set password failed. Please try again. | — |
| src/redesign/adapters/edgeError.ts last resort | Action failed. Please try again. | — |
| src/redesign/adapters/ig.ts igConnectFailText | rd_cm_reconnect_page (no "(IG code)") | (key) |
| src/redesign/adapters/fbReceipt.ts receiptFailText (polish off) | rd_cm_reconnect_page when Facebook sent a code; no "(FB code)" ever | (key) |
| src/redesign/screens/ParcelScan.tsx 1178/1268/1319/1336/1345/1519/1520 | raw reason/code spans removed; scan error shows rd_ps2_scan_clearer | (keys) |
| src/redesign/screens/Shipping.tsx 140/181/198/241/258 | {err} removed (rd_shp_save_failed / _export_failed / _dl_failed) | (keys) |
| src/redesign/screens/PrinterSettings.tsx 83/88 | raw Bluetooth text removed → rd_ps_scan_unavail / rd_ps_bt_saved | (keys) |
| src/redesign/screens/PrintPattern.tsx 172–181 | sample Session:/Buyer 12/Comment → rd_pp_sample_* | (keys) |
| src/redesign/screens/GeneralSettings.tsx profile card | {plan} plan · renews {date} in the seller's language (rd_set_plan_*); profile save error → rd_set_profile_save_failed | (keys) |
| src/redesign/screens/DeleteAccount.tsx | protected_admin/protected_master → rd_del_protected; anything else → rd_del_generic; r.error never shown | (keys) |
| src/redesign/components/SoonBadge.tsx | rd_soon / rd_soon_title | (keys) |
| src/redesign/screens/Orders.tsx aria-label | rd_ord_search_clear | (key) |
| src/redesign/screens/Landing.tsx footer Terms | existing rd_terms | (key) |
| index.html / redesign.html meta description | Turn live comments into orders and print in 1 click. (font comment removed) | — |
| mobile/ios/App/App/Info.plist | CFBundleDisplayName SellerFlowLive; NSLocalNetworkUsageDescription "SellerFlowLive needs this to print on your WiFi printer."; camera + Bluetooth texts say SellerFlowLive | — |
| mobile/android/.../values/strings.xml | app_name + title_activity_main = SellerFlowLive | — |
| public/privacy/index.html:52 | …services that run the app (hosting, storage, analytics, reading the parcel slips you photograph, connecting to your live, 7-ELEVEN shipping)… | — |
| public/privacy/index.html:55 | The buyer's Messenger contact: 90 days. | — |
| public/delete-account/index.html:41 | **Master plan:** This account can't be deleted in the app. Message us and we'll do it. | — |

**Removed keys:** `rd_cm_add_fb`, `rd_cm_fb_id`, `rd_cm_access_token` (no code used them; the only reference is ConnectModal.fbGate.test.tsx, which asserts they are NOT used — left as is).

## 2. Strings added or changed outside the Part A pass

| key or file | new en | new fil |
|---|---|---|
| `rd_cm_tt_cooldown` (NEW, shown for E41/E42) | Too many connects. Wait {n} minutes, then try again. | Masyadong maraming connect. Maghintay ng {n} minuto, tapos subukan ulit. |
| `rd_cm_plan_ended` (NEW) | Your plan has ended. Renew to connect again. | Tapos na ang plan mo. Mag-renew para maka-connect ulit. |
| `rd_ch_save_failed` (NEW) | Couldn't save your accounts. Please try again. | Hindi na-save ang accounts mo. Subukan ulit. |
| `rd_loading` (NEW) | Loading… | Naglo-load… |
| `lp_login`, `lp_feat_print_t`, `lp_feat_capture_t`, `lp_feat_orders_t` (moved from the old app file, values unchanged) | Log in · 1-Click Print · Live Comment Capture · Order Management | Mag-log in · 1-Click Print · Live Comment Capture · Order Management |
| `rd_rc_so_default` vi / th / id / bg + server sold-out defaults | (own language instead of English) | — |
| fb.ts connect toast with a Facebook code (polish off) | Couldn't connect. Please reconnect your Page. (was "… (FB 190)") | Hindi maka-connect. I-reconnect ang Page mo. |
| printing.ts slip alert | the seller words only (the printer's own message is no longer shown) | — |
| edge guards.ts (admin) | No account with that email. Try 'Clean up empty accounts'. | — |
| edge index.ts (admin, 500) | Couldn't delete this account. Please try again. | — |
| edge index.ts (admin, no email) | Enter an email. | — |
| server.js GET / | OK | — |
| server.js connect "already connected" | Connected to your TikTok LIVE. | — |
| Chrome extension popup | Status · 7-11 seller page · 7-11 store map · Computer name · Connection link · Connection code · Your 7-11 shop ID · Your phone number · Save · Check for all sellers · Checking now · Waiting — another computer is checking (…) · Paused — reconnecting · Reconnecting — still checking · This computer is not checking — turn on "Check for all sellers" · Reconnecting… · Click the SellerFlowLive tab once · Hasn't checked in a while — click the 7-11 tab · 7-11 store map logged out — open it again from 選擇門市 · Set up the connection first · Couldn't load parcels. Log in again. · 7-11 page logged out — log in again · 7-11 store map not ready — reopen it | (operator tool, English only) |
