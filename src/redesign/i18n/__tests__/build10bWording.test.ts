// Build 10b — Part A wording (docs/audits/build10-report.md), owner-approved.
// (a) every key added or changed in this pass, with its exact en + fil text;
// (b) all 8 languages filled + the same {placeholders} in every language;
// (c) no i18n value in ANY language names the tools behind the app;
// (d) the removed keys are gone.
import { describe, it, expect } from "vitest";
import { REDESIGN_STRINGS, buildT } from "../index";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;

const PINS: Record<string, { en: string; fil: string }> = {
  lg_keep_p: { en: "Live comments: 10 days. Order history: 3 months. Messenger receipt pictures: 24 hours. Receipt records: 3 months. Parcel status: 7 days after pickup, 365 days after return. Your account, customer list and settings: until you delete your account. The buyer's Messenger contact: 90 days. Waiting list: 10 days.", fil: "Live comments: 10 araw. Kasaysayan ng order: 3 buwan. Mga larawan ng Messenger receipt: 24 oras. Mga record ng resibo: 3 buwan. Status ng parcel: 7 araw pagkakuha, 365 araw pagkabalik. Ang iyong account, listahan ng customer at settings: hanggang burahin mo ang iyong account. Messenger contact ng buyer: 90 araw. Pila ng naghihintay: 10 araw." },
  rd_adm_act_setpw: { en: "Set password", fil: "Itakda ang password" },
  rd_adm_exp_h_7d: { en: "7 days", fil: "7 araw" },
  rd_adm_exp_h_last: { en: "Last month", fil: "Nakaraang buwan" },
  rd_adm_exp_h_lastexp: { en: "Last export", fil: "Huling export" },
  rd_adm_exp_h_pickup: { en: "Pickup", fil: "Pickup" },
  rd_adm_exp_h_plan: { en: "Plan", fil: "Plan" },
  rd_adm_exp_h_seller: { en: "Seller", fil: "Seller" },
  rd_adm_exp_h_this: { en: "This month", fil: "Ngayong buwan" },
  rd_adm_exp_line: { en: "{plan} · last month {last} · 7d {d7} · last {day} · Pickup {pickup}", fil: "{plan} · nakaraang buwan {last} · 7 araw {d7} · huli {day} · Pickup {pickup}" },
  rd_adm_exp_load_err: { en: "Couldn't load exports", fil: "Hindi ma-load ang exports" },
  rd_adm_exp_no_link: { en: "no shop link", fil: "walang shop link" },
  rd_adm_exp_none: { en: "No exports yet", fil: "Wala pang export" },
  rd_adm_exp_summary: { en: "This month {a} · Last month {b} · {n} sellers", fil: "Ngayong buwan {a} · Nakaraang buwan {b} · {n} seller" },
  rd_adm_exp_title: { en: "Exports per seller", fil: "Mga export kada seller" },
  rd_adm_failed: { en: "✗ {label} failed. Please try again.", fil: "✗ Nabigo ang {label}. Subukan ulit." },
  rd_adm_pm_scan_cost: { en: "Cost per scan", fil: "Gastos kada scan" },
  rd_adm_pm_scan_cost_hint: { en: "Adjustable — recomputes cost & profit", fil: "Nababago — muling kinukwenta ang cost at profit" },
  rd_adm_pm_untracked_note: { en: "{n} scan(s) this month happened before results were recorded — not counted above.", fil: "{n} scan ngayong buwan ay nangyari bago pa naitala ang resulta — hindi kasama sa itaas." },
  rd_adm_sample_note: { en: "Sample data — not live yet", fil: "Sample data — hindi pa live" },
  rd_ann_translate_fail: { en: "Couldn't translate right now. Send in English or try again.", fil: "Hindi maisalin ngayon. I-send sa English o subukan ulit." },
  rd_auto_stock_failed: { en: "Saved on this phone only — it didn't go online. Check your connection.", fil: "Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet." },
  rd_ba_at_store: { en: "At 7-11", fil: "Nasa 7-11" },
  rd_ba_near_line: { en: "Parcel at 7-11 {store} — {n} days left before it's returned", fil: "May parcel sa 7-11 {store} — {n} days na lang bago ma-return" },
  rd_ba_picked_up: { en: "Picked up (7 days)", fil: "Nakuha (7 days)" },
  rd_ch_id_tiktok: { en: "TikTok username", fil: "TikTok username" },
  rd_ch_pop_body_tt: { en: "To add a TikTok username for LIVE multi-account, please message our admin on Telegram and we'll set it up for you.", fil: "Para magdagdag ng TikTok username para sa LIVE multi-account, mag-message sa aming admin sa Telegram at ise-set up namin ito para sa iyo." },
  rd_cm_cant_reach: { en: "Can't connect right now. Check your internet and try again.", fil: "Hindi maka-connect ngayon. I-check ang internet mo at subukan ulit." },
  rd_cm_conn_try_again: { en: "Couldn't connect. Make sure you're LIVE, then try again.", fil: "Hindi maka-connect. Siguraduhing naka-LIVE ka, tapos subukan ulit." },
  rd_cm_footer: { en: "Live connect works in the SellerFlowLive app.", fil: "Sa SellerFlowLive app gumagana ang live connect." },
  rd_cm_reconnect_page: { en: "Couldn't connect. Please reconnect your Page.", fil: "Hindi maka-connect. I-reconnect ang Page mo." },
  rd_cm_tt_cooldown: { en: "Too many connects. Wait {n} minutes, then try again.", fil: "Masyadong maraming connect. Maghintay ng {n} minuto, tapos subukan ulit." },
  rd_cm_tt_ph: { en: "e.g. yourshop_live", fil: "e.g. yourshop_live" },
  rd_dash_ent_title: { en: "Type price — enter a price, then press Enter to print", fil: "I-type ang presyo — ilagay ang presyo, tapos Enter para mag-print" },
  rd_dash_enterprise: { en: "Type price", fil: "I-type ang presyo" },
  rd_dash_inject_title: { en: "Add a practice comment", fil: "Magdagdag ng practice comment" },
  rd_dash_risk_risky: { en: "New account (under 7 days) with no followers", fil: "Bagong account (wala pang 7 araw), walang followers" },
  rd_del_protected: { en: "This account can't be deleted in the app. Message us and we'll do it.", fil: "Hindi ma-delete sa app ang account na ito. I-message mo kami, kami na bahala." },
  rd_exp_loaded_note: { en: "Export includes only the customers shown — tap Load more first for all.", fil: "Kasama lang sa export ang mga customer na nakikita — i-tap muna ang Load more para sa lahat." },
  rd_fb_page_id: { en: "Page", fil: "Page" },
  rd_l2_b3_d: { en: "Sticker and receipt slips on Bluetooth & WiFi printers — Chinese names included.", fil: "Sticker at receipt slips sa Bluetooth at WiFi printers — kasama ang Chinese names." },
  rd_l2_d1_l1: { en: "Bluetooth sticker printers & WiFi receipt printers", fil: "Bluetooth sticker printers at WiFi receipt printers" },
  rd_l2_faq_a3: { en: "Bluetooth thermal sticker printers (like AIMO) and WiFi receipt printers (like Xprinter). Chinese buyer names print correctly.", fil: "Bluetooth thermal sticker printers (tulad ng AIMO) at WiFi receipt printers (tulad ng Xprinter). Tama ang print ng Chinese na pangalan." },
  rd_l2_g2_d: { en: "Pair your Bluetooth sticker printer or WiFi receipt printer.", fil: "I-pair ang Bluetooth sticker printer o WiFi receipt printer mo." },
  rd_login_err_wrong: { en: "Wrong email or password.", fil: "Mali ang email o password." },
  rd_login_unavailable: { en: "Sign-in isn't available right now. Please try again later.", fil: "Hindi pa puwedeng mag-log in ngayon. Subukan ulit mamaya." },
  rd_lss_sp_text: { en: "While this is on, every 1-Click and Auto order prints this price, whatever the buyer types. In Type price, the price is pre-filled but you can still change it.", fil: "Habang naka-on ito, bawat 1-Click at Auto order ay magpi-print ng presyong ito, kahit ano pa ang i-type ng buyer. Sa I-type ang presyo, naka-pre-fill ang presyo pero puwede mo pa rin itong palitan." },
  rd_ord_save_failed: { en: "Saved on this phone only — it didn't go online. Check your connection.", fil: "Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet." },
  rd_ord_search_clear: { en: "Clear search", fil: "I-clear ang search" },
  rd_pp_approx: { en: "Approximate — Simple print is on, so the layout may differ", fil: "Tantiya lang — naka-on ang Simple print, kaya maaaring iba ang ayos" },
  rd_pp_sample_buyer: { en: "Buyer 12", fil: "Buyer 12" },
  rd_pp_sample_comment: { en: "Comment", fil: "Komento" },
  rd_pp_sample_session: { en: "Session:", fil: "Session:" },
  rd_pr_native_note: { en: "Printing runs in the SellerFlowLive app — open it on your phone to print.", fil: "Tumatakbo sa SellerFlowLive app ang pag-print — buksan ito sa iyong telepono para mag-print." },
  rd_pr_sent: { en: "Sent to printer.", fil: "Naipadala na sa printer." },
  rd_prd_pic_too_big: { en: "This picture is too big. Pick a smaller one.", fil: "Masyadong malaki ang picture. Pumili ng mas maliit." },
  rd_prd_search: { en: "Search name or item code", fil: "Maghanap ng pangalan o item code" },
  rd_prd_sku: { en: "Item code", fil: "Item code" },
  rd_prd_sync_failed: { en: "Saved on this phone only — it didn't go online. Check your connection.", fil: "Sa phone na 'to lang na-save — hindi pa naka-online. I-check ang internet." },
  rd_print_native_failed: { en: "Couldn't print — check your printer is on and connected.", fil: "Hindi nag-print — i-check kung naka-on at connected ang printer." },
  rd_ps2_ai_soon: { en: "Snap a parcel slip, we fill in the details — coming soon", fil: "Picturan ang parcel slip, kami na ang mag-fill in — malapit na" },
  rd_ps2_delete_err: { en: "Couldn't delete. Please try again.", fil: "Hindi nabura. Subukan ulit." },
  rd_ps2_err_save: { en: "Save failed. Please try again.", fil: "Hindi na-save. Subukan ulit." },
  rd_ps2_orphan_title: { en: "{n} parcels started exporting at {time}, but we don't know if the file was uploaded", fil: "{n} parcel ang nagsimulang i-export nang {time}, pero hindi namin alam kung na-upload ang file" },
  rd_ps2_pending_q: { en: "{n} parcel(s) are still being checked. Exported parcels won't be checked anymore. Wait a moment, or export anyway?", fil: "{n} parcel ang sinusuri pa. Hindi na susuriin ang mga na-export na parcel. Maghintay sandali, o i-export na rin?" },
  rd_ps2_recheck_q: { en: "Check this parcel again?", fil: "I-check ulit ang parcel na 'to?" },
  rd_ps2_restricted: { en: "number can't be used", fil: "hindi puwede ang number" },
  rd_ps2_scan_clearer: { en: "Try a clearer photo of the parcel slip.", fil: "Subukan ang mas malinaw na picture ng parcel slip." },
  rd_ps2_sub: { en: "Snap handwritten parcel slips — we fill in the details", fil: "Picturan ang sulat-kamay na parcel slip — kami na ang mag-fill in" },
  rd_ps2_undo_failed: { en: "Undo failed. Please try again.", fil: "Hindi na-undo. Subukan ulit." },
  rd_ps2_x_failed: { en: "Export failed. Please try again.", fil: "Hindi na-export. Subukan ulit." },
  rd_ps_aimo: { en: "AIMO D520BT (100×60mm)", fil: "AIMO D520BT (100×60mm)" },
  rd_ps_bt_saved: { en: "Printer saved.", fil: "Na-save ang printer." },
  rd_ps_classic_text: { en: "Simple print", fil: "Simple print" },
  rd_ps_classic_text_desc: { en: "Simple print — turn ON only if stickers come out blank or wrong.", fil: "Simple print — i-ON lang kung blangko o mali ang sticker." },
  rd_ps_ip: { en: "Printer number (from its test page)", fil: "Number ng printer (mula sa test page)" },
  rd_ps_native_note: { en: "Printer connection runs in the SellerFlowLive app — these controls work on your phone, not in the web preview.", fil: "Tumatakbo sa SellerFlowLive app ang koneksyon ng printer — gumagana ang mga kontrol na ito sa iyong telepono, hindi sa web preview." },
  rd_ps_open_app_connect: { en: "Open the SellerFlowLive app on your phone to connect a printer.", fil: "Buksan ang SellerFlowLive app sa iyong telepono para ikonekta ang printer." },
  rd_ps_open_app_scan: { en: "Open the SellerFlowLive app on your phone to scan Bluetooth printers.", fil: "Buksan ang SellerFlowLive app sa iyong telepono para mag-scan ng Bluetooth printer." },
  rd_ps_open_app_test: { en: "Open the SellerFlowLive app on your phone to test-print.", fil: "Buksan ang SellerFlowLive app sa iyong telepono para mag-test-print." },
  rd_ps_port: { en: "Second number (usually 9100)", fil: "Pangalawang number (kadalasan 9100)" },
  rd_ps_web_driver_size: { en: "Set your label size in your computer's printer settings — we fit one label.", fil: "Itakda ang label size sa printer settings ng computer mo — isang label ang ia-akma namin." },
  rd_pt_sync_empty: { en: "No parcels found in this file — use the 匯出報表 file.", fil: "Walang parcel sa file na ito — gamitin ang 匯出報表 file." },
  rd_rc_so_hint: { en: "Auto mode: when a Facebook buyer comments a code that is already sold out, they get this one private message in Messenger (once per comment). Write {code} where you want the code to appear.", fil: "Auto mode: kapag nag-comment ang Facebook buyer ng code na sold out na, matatanggap niya ang isang private message na ito sa Messenger (isang beses kada comment). Isulat ang {code} kung saan mo gustong lumabas ang code." },
  rd_rs_too_big: { en: "This picture is too big. Shorten the list or the note.", fil: "Masyadong malaki ang picture. Paikliin ang listahan o ang paalala." },
  rd_set_plan_only: { en: "{plan} plan", fil: "{plan} plan" },
  rd_set_plan_renews: { en: "{plan} plan · renews {date}", fil: "{plan} plan · magre-renew sa {date}" },
  rd_set_prn_wifi: { en: "WiFi receipt printer", fil: "WiFi na resibo printer" },
  rd_set_profile_save_failed: { en: "Couldn't save your profile. Please try again.", fil: "Hindi na-save ang profile mo. Subukan ulit." },
  rd_shp_connect_failed: { en: "Couldn't connect your Shopee shop. Please try again.", fil: "Hindi ma-connect ang Shopee shop mo. Subukan ulit." },
  rd_shp_dl_failed: { en: "Your entries are marked exported, but the file didn't download. Try again on a computer.", fil: "Na-mark nang exported, pero hindi na-download ang file. Subukan ulit sa computer." },
  rd_shp_err_total_high: { en: "Order + fee must not go over NT$20,000 — split into bags.", fil: "Hindi puwedeng lumagpas sa NT$20,000 ang order + fee — hatiin sa ilang bag." },
  rd_shp_export: { en: "Export 7-11 file ({n})", fil: "I-export ang 7-11 file ({n})" },
  rd_shp_export_browser: { en: "Exporting the 7-11 file needs a browser — open sellerflowlive.com on your computer or phone browser. Everything you encoded here is already saved.", fil: "Kailangan ng browser para i-export ang 7-11 file — buksan ang sellerflowlive.com sa computer o phone browser mo. Naka-save na ang lahat ng na-encode mo rito." },
  rd_shp_export_failed: { en: "Couldn't export. Please try again.", fil: "Hindi na-export. Subukan ulit." },
  rd_shp_export_ok: { en: "{n} exported — {file} downloaded. Upload it at myship.7-11.com.tw.", fil: "{n} na-export — na-download ang {file}. I-upload ito sa myship.7-11.com.tw." },
  rd_shp_free_rule_hint: { en: "New entries for buyers totaling {amt} or more start with fee 0. Each bag still needs at least NT$55.", fil: "Ang mga bagong entry para sa buyer na umabot ng {amt} pataas ay magsisimula sa fee 0. Kailangan pa rin ng hindi bababa sa NT$55 kada bag." },
  rd_shp_max_rows: { en: "Max {max} buyers per file — {n} selected. Export in smaller batches.", fil: "Hanggang {max} buyer lang kada file — {n} ang napili. I-export nang paunti-unti." },
  rd_shp_not_live: { en: "Couldn't start — check your Live code and that your Shopee Live is running.", fil: "Hindi nagsimula — i-check ang Live code mo at kung naka-live ka sa Shopee." },
  rd_shp_preview_note: { en: "Shopee connect is coming soon.", fil: "Malapit nang magamit ang Shopee connect." },
  rd_shp_save_failed: { en: "Couldn't save — check your connection and try again.", fil: "Hindi na-save — i-check ang internet at subukan ulit." },
  rd_shp_session_help: { en: "Open your Shopee live page, copy your Live code and paste it here.", fil: "Buksan ang Shopee live page mo, kopyahin ang Live code at i-paste dito." },
  rd_shp_session_label: { en: "Your Shopee Live code", fil: "Live code mo sa Shopee" },
  rd_shp_session_ph: { en: "Paste your Shopee Live code", fil: "I-paste ang Live code mo sa Shopee" },
  rd_shp_shop_id: { en: "Shop", fil: "Shop" },
  rd_shp_split_must: { en: "Over NT$20,000 — 7-11 won't take one bag above that. Split this buyer into bags.", fil: "Lagpas NT$20,000 — hindi tatanggapin ng 7-11 ang isang bag na lagpas doon. Hatiin ang buyer na ito sa ilang bag." },
  rd_shp_temp: { en: "Shipping temperature", fil: "Klase ng padala (normal o frozen)" },
  rd_soon: { en: "Soon", fil: "Malapit na" },
  rd_soon_title: { en: "Coming soon — not ready yet", fil: "Malapit na — hindi pa handa" },
  rd_su_err: { en: "Could not create your account. Please try again.", fil: "Hindi nagawa ang account mo. Subukan ulit." },
  rd_su_err_exists: { en: "That email is already registered. Try logging in.", fil: "May account na ang email na ito. Mag-login ka na lang." },
  rd_su_err_setup: { en: "Your account was created, but setup didn't finish. Please log in and try again.", fil: "Nagawa na ang account mo pero hindi natapos ang setup. Mag-login ka at subukan ulit." },
  rd_su_err_unavailable: { en: "You can't create an account right now. Please try again later.", fil: "Hindi pa pwedeng gumawa ng account ngayon. Subukan ulit mamaya." },
  rd_sup_g1_body: { en: "First, add your account in Channels: Go to Settings → Channels (or Manage Channels). Type your TikTok username (and Facebook, if you use it), then Save. Your accounts are now saved and ready.\n\nThen connect during your live:\nTikTok: Go live on TikTok first. On the Dashboard, tap Connect on your TikTok account. Once you're live and connected, the dot turns green and your comments start coming in.\nFacebook: Connect your Facebook Page once in Settings → Facebook. Go live from that Page, then tap Connect.\n\nTips: Your account must be actively live the moment you connect. Your plan sets how many accounts you can add (Basic 1, Pro 3, Master 5). To add more or change a locked account, message us on Telegram.", fil: "Una, idagdag ang account mo sa Channels: Pumunta sa Settings → Channels (o Manage Channels). I-type ang TikTok username mo (at Facebook, kung ginagamit mo), tapos Save. Naka-save na at handa na ang mga account mo.\n\nTapos kumonekta habang live ka:\nTikTok: Mag-live muna sa TikTok. Sa Dashboard, i-tap ang Connect sa TikTok account mo. Kapag live ka na at nakakonekta, magiging berde ang tuldok at magsisimulang pumasok ang mga komento.\nFacebook: I-connect mo minsan ang Facebook Page mo sa Settings → Facebook. Mag-live ka sa Page na 'yon, tapos i-tap ang Connect.\n\nMga tip: Dapat aktibong naka-live ang account mo sa mismong sandali ng pagkonekta. Ang plano mo ang nagtatakda kung ilang account ang pwede mong idagdag (Basic 1, Pro 3, Master 5). Para magdagdag pa o magpalit ng naka-lock na account, mag-message sa amin sa Telegram." },
  rd_sup_g5: { en: "How to use: 7-11 shipping export", fil: "Paano gamitin: 7-11 shipping export" },
  rd_sup_g5_body: { en: "1. After your live session, go to Orders → 🚚 Shipping\n2. Your buyers are automatically grouped by buyer number — one buyer = one bag = one shipping entry\n3. Tap \"Add shipping info\" for each buyer and enter:\n• Recipient's REAL NAME (max 10 characters, no numbers or symbols — usernames won't work)\n• Phone number (10 digits, starts with 09)\n• 7-11 store number (6 digits — tap the store lookup link to find it)\n4. Shipping fee defaults to NT$38 (the standard OPEN POINT rate). You can change it per buyer or tap \"Free shipping\" to absorb it yourself\n5. Too many items for one bag? Tap \"Split ›\" to divide into up to 6 bags — each bag gets its own label and fee. Orders over NT$20,000 must be split\n6. Select your entries and tap Export 7-11 file (use a computer or phone browser — on the app, encode here and export from a browser later; everything is saved automatically)\n7. Go to myship.7-11.com.tw → Order tools → Order import, and upload the exported file\n8. Get your shipping codes, send them to the OPEN POINT app, scan the QR at any ibon machine to print all labels at once, stick each label on the matching bag, and drop them off\n9. Ship within 4 days of getting your codes or the orders auto-cancel\n\nRules to remember: each bag's total (order + shipping) must be between NT$55 and NT$20,000.", fil: "1. Pagkatapos ng live mo, pumunta sa Orders → 🚚 Shipping\n2. Awtomatikong naka-grupo ang mga buyer ayon sa buyer number — isang buyer = isang bag = isang shipping entry\n3. I-tap ang \"Add shipping info\" sa bawat buyer at ilagay:\n• TOTOONG PANGALAN ng tatanggap (hanggang 10 character, walang numero o simbolo — hindi puwede ang username)\n• Phone number (10 digit, nagsisimula sa 09)\n• 7-11 store number (6 digit — i-tap ang store lookup link para mahanap)\n4. NT$38 ang default na shipping fee (karaniwang presyo ng OPEN POINT). Puwede mo itong palitan kada buyer o i-tap ang \"Free shipping\" kung ikaw ang sasagot\n5. Sobrang dami ng item para sa isang bag? I-tap ang \"Split ›\" para hatiin hanggang 6 na bag — may sariling label at fee ang bawat bag. Dapat hatiin ang order na lagpas NT$20,000\n6. Piliin ang mga entry at i-tap ang Export 7-11 file (gumamit ng computer o phone browser — sa app, mag-encode dito at mag-export sa browser mamaya; awtomatikong naka-save ang lahat)\n7. Pumunta sa myship.7-11.com.tw → Order tools → Order import, at i-upload ang na-export na file\n8. Kunin ang shipping codes, ipadala sa OPEN POINT app, i-scan ang QR sa kahit anong ibon machine para i-print lahat ng label nang sabay, idikit ang bawat label sa tamang bag, at i-drop off\n9. Ipadala sa loob ng 4 na araw mula nang makuha ang codes, kung hindi ay kusang makakansela ang mga order\n\nTandaan: ang kabuuan ng bawat bag (order + shipping) ay dapat nasa pagitan ng NT$55 at NT$20,000." },
  rd_wg_2: { en: "Print the printer's test page — it shows the printer's number (like 192.168.x.x).", fil: "I-print ang test page ng printer — nandoon ang number nito." },
  rd_wg_3: { en: "Enter that number on the next screen.", fil: "Ilagay ang number na iyon sa susunod na screen." },
  rd_wp_cmd_btn: { en: "Copy", fil: "Kopyahin" },
  rd_wp_cmd_label: { en: "Silent-print setup", fil: "Setup ng silent-print" },
  rd_wp_cmd_mac: { en: "Mac: open the Terminal app, paste this and press Return:  {cmd}", fil: "Mac: buksan ang Terminal app, i-paste ito at pindutin ang Return:  {cmd}" },
  rd_wp_kiosk_body: { en: "Go to Settings → Laptop auto-print. Tap Copy, then follow the steps to open the silent-print Chrome window.", fil: "Pumunta sa Settings → Laptop auto-print. I-tap ang Copy, tapos sundan ang steps para buksan ang silent-print na Chrome." },
  rd_wp_setup_body: { en: "Tap Copy, then follow the steps to open the silent-print Chrome window.", fil: "I-tap ang Copy, tapos sundan ang steps para buksan ang silent-print na Chrome." },
  rd_wp_setup_tip: { en: "Tip: use that Chrome window only for printing during your live.", fil: "Tip: gamitin lang ang Chrome window na iyon sa pag-print habang live ka." },
};

const REMOVED = ["rd_cm_add_fb", "rd_cm_fb_id", "rd_cm_access_token"];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort();

describe("Build 10b wording — exact en + fil", () => {
  for (const [k, v] of Object.entries(PINS)) {
    it(k, () => {
      expect(REDESIGN_STRINGS.en[k]).toBe(v.en);
      expect(REDESIGN_STRINGS.fil[k]).toBe(v.fil);
    });
  }
});

describe("Build 10b wording — every language filled, same {placeholders}", () => {
  it("all 8 languages non-empty for every pinned key", () => {
    for (const k of Object.keys(PINS)) for (const l of LANGS) {
      expect((REDESIGN_STRINGS[l][k] || "").trim().length, `${l}.${k}`).toBeGreaterThan(0);
    }
  });
  it("placeholders match the English text in every language", () => {
    for (const k of Object.keys(PINS)) {
      const want = placeholders(REDESIGN_STRINGS.en[k]);
      for (const l of LANGS) expect(placeholders(REDESIGN_STRINGS[l][k]), `${l}.${k}`).toEqual(want);
    }
  });
  it("rd_cm_tt_cooldown sits right after rd_cm_conn_try_again and carries {n}", () => {
    const keys = Object.keys(REDESIGN_STRINGS.en);
    expect(keys.indexOf("rd_cm_tt_cooldown")).toBe(keys.indexOf("rd_cm_conn_try_again") + 1);
    expect(REDESIGN_STRINGS.en.rd_cm_tt_cooldown).toContain("{n}");
  });
});

describe("Build 10b wording — nothing names the tools behind the app", () => {
  const BANNED = [/supabase/i, /edge function/i, /tspl/i, /bridge/i, /myship2/i, /duonglily/i];
  it("no redesign value in any language contains a banned word", () => {
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(REDESIGN_STRINGS[l])) {
        for (const re of BANNED) expect(v, `${l}.${k}`).not.toMatch(re);
      }
    }
  });
  it("the app name is always SellerFlowLive in redesign strings", () => {
    for (const l of LANGS) for (const [k, v] of Object.entries(REDESIGN_STRINGS[l])) {
      expect(v, `${l}.${k}`).not.toMatch(/SellerFlow(?!Live)/);
    }
  });
});

describe("Build 10b wording — removed keys", () => {
  it("unused Facebook token-method keys are gone in every language", () => {
    for (const k of REMOVED) {
      for (const l of LANGS) expect(REDESIGN_STRINGS[l][k], `${l}.${k}`).toBeUndefined();
      expect((buildT("en") as Record<string, string>)[k]).toBeUndefined();
    }
  });
});
