// PREVIEW-ONLY fake Supabase (never shipped). `vite.preview.config.ts` aliases every import of
// `src/supabase.ts` to this module, so the REAL app and REAL screens run against an in-memory
// database seeded for screenshots (docs/design/*): no network, no sign-in, no live columns
// needed. The query builder covers the PostgREST calls the app makes at load (select / eq /
// neq / in / is / not / gte / lte / order / range / limit / single / maybeSingle / head
// counts, insert / update / delete) — anything else resolves to empty data, never an error.
//   npx vite --config vite.preview.config.ts --port 5199
import { invoiceRows } from "../redesign/adapters/invoicing";
import { rebuildSessionFromRows } from "../lib/orderLogic";
type Row = Record<string, unknown>;
type Res = { data: unknown; error: null; count: number | null };

export const UID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "preview@sellerflowlive.com";
const now = Date.now();
const iso = (daysAgo: number): string => new Date(now - daysAgo * 86_400_000).toISOString();
const day = (daysAhead: number): string => new Date(now + daysAhead * 86_400_000).toISOString().slice(0, 10);

const tables: Record<string, Row[]> = {
  seller_profiles: [{
    auth_user_id: UID, email: EMAIL, full_name: "Preview Seller", store_name: "Budget Ukay Preview", phone: "0912345678",
    tiktok: "previewshop", facebook: "", admin_contact_note: "", country: "TW", plan: "pro", plan_status: "active",
    plan_expiry: "2027-12-31", trial_started_at: null, connected_accounts: [], role: typeof location !== "undefined" && /[?&]admin=1\b/.test(location.search) ? "admin" : "seller", created_at: iso(200),
  }],
  app_settings: [
    { key: "parcel_manual_enabled", value: "true" }, { key: "buyer_contact_enabled", value: "true" }, { key: "frozen_store_check_enabled", value: "true" },
    { key: "fm_scan_enabled", value: "true" }, { key: "fm_pickup_enabled", value: "true" },
    { key: "fm_shipping_fee", value: "39" }, { key: "shipping_fee_global", value: "38" },
    { key: "past_sessions_public", value: "true" }, // Orders → Sessions → a past session (export check)
    // Parcel Scan: Scan QR → fill from Customers (sql/149) — previews in docs/design/scan-qr-lookup/built.
    // Open the preview with ?qlookup=off to see the screen with the switch off.
    { key: "scan_qr_lookup_enabled", value: typeof location !== "undefined" && /[?&]qlookup=off\b/.test(location.search) ? "false" : "true" },
    // Native "Scan sticker QR" switch (sql/210) — the Orders Scan button shows only with it AND the phone
    // app's scanner (docs/design/native-qr-scanner/header-check.cjs fakes that plugin).
    { key: "native_qr_scanner_enabled", value: "true" },
    { key: "web_qr_scanner_enabled", value: "true" },
  ],
  // One finished 2-day session (Orders → Sessions picker + its Export). day(-n) = n days ago.
  live_session_orders: [
    { id: 9001, user_id: UID, session_id: "past-1", session_date: day(-9), created_at: `${day(-9)}T05:00:00.000Z`, buyer_number: 1, handle: "@oldann", customer_name: "Old Ann", platform: "TikTok", product: "A1 dress", price: 350, qty: 1, comment_msg_id: null, auto_code: null },
    { id: 9002, user_id: UID, session_id: "past-1", session_date: day(-8), created_at: `${day(-8)}T05:00:00.000Z`, buyer_number: 2, handle: "@oldbea", customer_name: "Old Bea", platform: "TikTok", product: "B2 top", price: 280, qty: 1, comment_msg_id: null, auto_code: null },
  ],
  parcel_scans: [
    { id: "s1", user_id: UID, customer_name: "王小美", phone: "0912345678", store_id: "266402", amount: 550, notes: "maria_shops", contact_platform: null, status: "confirmed", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: null, created_at: iso(0.1) },
    { id: "s2", user_id: UID, customer_name: "陳大文", phone: "0922333444", store_id: "133712", amount: 1200, notes: "+886922333444", contact_platform: "whatsapp", status: "confirmed", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: null, created_at: iso(0.2) },
    { id: "s3", user_id: UID, customer_name: "林雅婷", phone: "0933555666", store_id: "991120", amount: 380, notes: "yating.line", contact_platform: "line", status: "exported", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: null, created_at: iso(1) },
    // 冷凍 rows (sql/142 frozen store check): one per frozen state — previews in docs/design/frozen-store-check
    { id: "s4", user_id: UID, customer_name: "新蓮盈買家", phone: "0944111222", store_id: "968551", amount: 650, notes: "frozen_buyer_a", contact_platform: null, status: "confirmed", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: "冷凍", frozen_store_status: "no_frozen", created_at: iso(0.05) },
    { id: "s5", user_id: UID, customer_name: "大智通買家", phone: "0955333444", store_id: "151003", amount: 650, notes: "frozen_buyer_b", contact_platform: null, status: "confirmed", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: "冷凍", frozen_store_status: null, created_at: iso(0.06) },
    { id: "s6", user_id: UID, customer_name: "樹林買家", phone: "0966555666", store_id: "133712", amount: 650, notes: "frozen_buyer_c", contact_platform: null, status: "confirmed", store_check_status: "valid", store_full_status: "open", phone_check_status: "ok", phone_restricted_until: null, temp_layer: "冷凍", frozen_store_status: "ok", created_at: iso(0.07) },
  ],
  parcel_customers: [
    { id: "c1", user_id: UID, phone: "0912345678", name: "王小美", store_id: "266402", notes: "maria_shops", contact_platform: null, created_at: iso(30), updated_at: iso(0.1) },
    { id: "c2", user_id: UID, phone: "0922333444", name: "陳大文", store_id: "133712", notes: "+886922333444", contact_platform: "whatsapp", created_at: iso(20), updated_at: iso(0.2) },
    { id: "c3", user_id: UID, phone: "0933555666", name: "林雅婷", store_id: "991120", notes: "yating.line", contact_platform: "line", created_at: iso(10), updated_at: iso(1) },
    { id: "c4", user_id: UID, phone: "0955777888", name: "Joy Reyes", store_id: "211004", notes: "joy.reyes.90", contact_platform: "facebook", created_at: iso(9), updated_at: iso(2) },
    { id: "c5", user_id: UID, phone: "0966888999", name: "Ana Cruz", store_id: "170331", notes: "ana.cruz_ig", contact_platform: "instagram", created_at: iso(8), updated_at: iso(3) },
    { id: "c6", user_id: UID, phone: "0977999000", name: "張美玲", store_id: "150210", notes: "Telegram @meiling", contact_platform: "other", created_at: iso(7), updated_at: iso(4) },
    // Scan QR fill previews: one username with 3 records — the NEWEST (c7, saved as "@annc_tw (U)") is the one
    // that is filled; near-names and a LINE record with the same text must NOT be used
    { id: "c7", user_id: UID, phone: "0922333444", name: "陳安安", store_id: "266402", notes: "@annc_tw (U)", contact_platform: null, created_at: iso(60), updated_at: iso(8) },
    { id: "c8", user_id: UID, phone: "0922333444", name: "陳安安", store_id: "133712", notes: "annc_tw", contact_platform: null, created_at: iso(50), updated_at: iso(30) },
    { id: "c9", user_id: UID, phone: "0955123456", name: "Ann Chen", store_id: "133712", notes: "Annc_TW", contact_platform: null, created_at: iso(70), updated_at: iso(44) },
    { id: "c10", user_id: UID, phone: "0988111222", name: "不相干的人", store_id: "170331", notes: "annc_tw2", contact_platform: null, created_at: iso(5), updated_at: iso(1) },
    { id: "c11", user_id: UID, phone: "0988333444", name: "LINE 買家", store_id: "170331", notes: "annc_tw", contact_platform: "line", created_at: iso(5), updated_at: iso(1) },
    // …and a word the seller writes for MANY buyers ("user": 3 different phones) → a scan of @user fills nothing
    { id: "c12", user_id: UID, phone: "0933111222", name: "林小姐", store_id: "170331", notes: "user", contact_platform: null, created_at: iso(20), updated_at: iso(2) },
    { id: "c13", user_id: UID, phone: "0944222333", name: "Grace Tan", store_id: "211004", notes: "@user", contact_platform: null, created_at: iso(22), updated_at: iso(3) },
    { id: "c14", user_id: UID, phone: "0966444555", name: "吳先生", store_id: "150210", notes: "user", contact_platform: null, created_at: iso(25), updated_at: iso(5) },
  ],
  fm_parcel_scans: [
    { id: "f1", user_id: UID, recipient_name: "黃志明", phone: "0911222333", store_id: "022131", amount: 450, shipping_fee: 39, order_date: day(0), buyer_username: "+886911222333", contact_platform: "whatsapp", created_at: iso(0.3), exported_at: null, export_batch_id: null },
  ],
  fm_parcel_customers: [
    { id: "fc1", user_id: UID, phone: "0911222333", name: "黃志明", store_id: "022131", buyer_username: "+886911222333", contact_platform: "whatsapp", created_at: iso(5), updated_at: iso(0.3) },
    // Scan QR fill previews (FamilyMart keeps its OWN Customers — nothing is read from the 7-11 ones)
    { id: "fc2", user_id: UID, phone: "0912345678", name: "王小美", store_id: "022131", buyer_username: "@Maria_Shops", contact_platform: null, created_at: iso(30), updated_at: iso(6) },
    { id: "fc3", user_id: UID, phone: "0922333444", name: "陳安安", store_id: "022131", buyer_username: "@annc_tw (U)", contact_platform: null, created_at: iso(60), updated_at: iso(8) },
    { id: "fc4", user_id: UID, phone: "0922333444", name: "陳安安", store_id: "018274", buyer_username: "@annc_tw", contact_platform: null, created_at: iso(50), updated_at: iso(30) },
    { id: "fc5", user_id: UID, phone: "0955123456", name: "陳安", store_id: "018274", buyer_username: "ANNC_TW", contact_platform: null, created_at: iso(70), updated_at: iso(44) },
    // must NOT be used for @annc_tw: a longer username, and the same text saved as a LINE contact (both newer)
    { id: "fc9", user_id: UID, phone: "0988111222", name: "不相干的人", store_id: "018274", buyer_username: "annc_tw2", contact_platform: null, created_at: iso(5), updated_at: iso(1) },
    { id: "fc10", user_id: UID, phone: "0988333444", name: "LINE 買家", store_id: "018274", buyer_username: "annc_tw", contact_platform: "line", created_at: iso(5), updated_at: iso(1) },
    // a word written for MANY buyers ("user": 3 different phones) → a scan of @user fills nothing
    { id: "fc6", user_id: UID, phone: "0933111222", name: "林小姐", store_id: "022131", buyer_username: "user", contact_platform: null, created_at: iso(20), updated_at: iso(2) },
    { id: "fc7", user_id: UID, phone: "0944222333", name: "Grace Tan", store_id: "018274", buyer_username: "@user", contact_platform: null, created_at: iso(22), updated_at: iso(3) },
    { id: "fc8", user_id: UID, phone: "0966444555", name: "吳先生", store_id: "022131", buyer_username: "user", contact_platform: null, created_at: iso(25), updated_at: iso(5) },
  ],
  // ?bl=1 (with ?admin=1, the admin sees Blacklist): a few made-up Blacklist rows, one with a very long
  // Facebook name, so the Remove sheet can be opened in pictures.
  buyer_blacklist: typeof location !== "undefined" && /[?&]bl=1\b/.test(location.search) ? [
    { id: "bl1", user_id: UID, platform: "tiktok", buyer_label: "maria_shop", buyer_key: "maria_shop", reason: "returned", added_day: day(-1), created_at: iso(1) },
    { id: "bl2", user_id: UID, platform: "tiktok", buyer_label: "maria_shop", buyer_key: "maria_shop", reason: "not_checked_out", added_day: day(-4), created_at: iso(4) },
    { id: "bl3", user_id: UID, platform: "facebook", buyer_label: "Ana Reyes", buyer_key: "ana reyes", reason: "not_checked_out", added_day: day(-2), created_at: iso(2) },
    { id: "bl4", user_id: UID, platform: "facebook", buyer_label: "Maria Cristina Dela Cruz Santos Villanueva Reyes Mendoza Bautista Ocampo", buyer_key: "maria cristina dela cruz santos villanueva reyes mendoza bautista ocampo", reason: "returned", added_day: day(-3), created_at: iso(3) },
  ] : [],
  parcel_tracking: [
    { id: "t1", user_id: UID, tracking_no: "F1234567890", cm_order_no: null, buyer_username: "+886922333444", recipient_name: "陳*文", store_id: "133712", rec_store: "民生門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(3), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 1200, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t2", user_id: UID, tracking_no: "F2234567890", cm_order_no: null, buyer_username: "yating.line", recipient_name: "林*婷", store_id: "991120", rec_store: "松山門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(2), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 380, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t3", user_id: UID, tracking_no: "F3234567890", cm_order_no: null, buyer_username: "joy.reyes.90", recipient_name: "J*y", store_id: "211004", rec_store: "中山門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(5), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 890, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t4", user_id: UID, tracking_no: "F4234567890", cm_order_no: null, buyer_username: "ana.cruz_ig", recipient_name: "A*a", store_id: "170331", rec_store: "信義門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(6), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 650, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t5", user_id: UID, tracking_no: "F5234567890", cm_order_no: null, buyer_username: "maria_shops", recipient_name: "王*美", store_id: "266402", rec_store: "南京門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(4), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 550, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t6", user_id: UID, tracking_no: "F6234567890", cm_order_no: null, buyer_username: "oldbuyer (IG)", recipient_name: "L*o", store_id: "300100", rec_store: "復興門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(7), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 420, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t7", user_id: UID, tracking_no: "F7234567890", cm_order_no: null, buyer_username: "Telegram @meiling", recipient_name: "張*玲", store_id: "150210", rec_store: "敦化門市", status: "at_store", status_message: "包裹已到店", pickup_deadline: day(8), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 300, terminal: false, last_polled_at: iso(0.1), carrier: "711" },
    { id: "t8", user_id: UID, tracking_no: "E8234567890", cm_order_no: null, buyer_username: "+886911222333", recipient_name: "黃*明", store_id: "022131", rec_store: "全家忠孝店", status: "at_store", status_message: "已到店", pickup_deadline: day(5), arrived_at: iso(1), ship_type: "C2C", special_type: null, order_amount: 450, terminal: false, last_polled_at: iso(0.1), carrier: "fm" },
  ],
};
// Invite friends previews (sql/165, docs/design/invite-referral): ?inv=choose (no code yet) /
// ?inv=free (has a code, free plan) / default (has a code + invites). ?admin=1 = admin role.
const Q = typeof location !== "undefined" ? location.search : "";
const INV = (/[?&]inv=(\w+)/.exec(Q) || [])[1] || "";
// Settings tab previews (docs/design/invoicing-soon): ?web=1 = the Website card is shown · ?web=soon = its "Soon" teaser.
if (/[?&]web=1\b/.test(Q)) tables.app_settings.push({ key: "seller_website_enabled", value: "true" });
if (/[?&]web=soon\b/.test(Q)) tables.app_settings.push({ key: "website_teaser_enabled", value: "true" });
const monthStart = (add: number) => { const d = new Date(now + 8 * 3_600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1)).toISOString().slice(0, 10); };
// ?quota=used,limit,locked → the "Accounts used: x of y" line (docs/design/account-limits-v2); absent = no line.
const QUOTA = typeof location !== "undefined" ? new URLSearchParams(location.search).get("quota") : null;
const quotaAnswer = (): unknown => {
  if (!QUOTA) return null;
  const [used, limit, locked] = QUOTA.split(",").map(Number);
  return { used, limit, unlimited: false, locked: locked || 0, next_free_at: null };
};
let seedInvoiceSends: (() => void) | null = null;   // set by ?ivc= below; run on the first read of invoice_sends
const RPC: Record<string, unknown> = {
  account_quota: quotaAnswer(),
  blacklist_add: { result: "added", id: "preview-added-1", day: day(0) }, // Blacklist "Add" in a preview (previews/web-qr-scanner)
  my_referral_summary: INV === "choose"
    ? { code: null, month_days: 10, eligible: true, has_inviter: false, can_enter_code: true, invites: [] }
    : { code: "BUDGETUKAY", month_days: 10, eligible: INV !== "free", has_inviter: false, can_enter_code: INV === "free",
        invites: [
          { email: "ann…", status: "rewarded", days: 10, date: iso(2) },
          { email: "mei…", status: "linked", days: 0, date: iso(4) },
          { email: "joy…", status: "no_reward", days: 0, date: iso(12) },
          { email: "lin…", status: "rewarded", days: 7, date: iso(40) },
        ] },
  invite_code_available: "",
  check_invite_code: true,
  admin_referral_overview: { [UID]: { code: "PREVIEW1", linked: true, status: "linked", inviter_email: "budgetukay@gmail.com", inviter_plan: "pro", reward_days: 0, would_reward: true, days: 10, reason: "" } },
  admin_invite_reward_months_get: [0, 1, 2, 3, 4, 5].map((i) => ({ month: monthStart(i), days: i === 0 ? 10 : i === 1 ? 7 : null, is_now: i === 0 })),
  admin_referrals_list: { total: 3, rows: [
    { id: "r1", inviter_expiry: "2027-01-20T04:00:00Z", invitee_user_id: "f1", invitee_email: "annie.shop@gmail.com", inviter_user_id: UID, inviter_email: "budgetukay@gmail.com", inviter_code: "BUDGETUKAY", source: "signup", status: "rewarded", reward_days: 10, reward_month: monthStart(0), rewarded_at: iso(2), skip_reason: null, created_at: iso(5), revoked_at: null },
    { id: "r2", inviter_expiry: "2027-01-20T04:00:00Z", invitee_user_id: "f2", invitee_email: "meiling.live@gmail.com", inviter_user_id: UID, inviter_email: "budgetukay@gmail.com", inviter_code: "BUDGETUKAY", source: "settings", status: "linked", reward_days: 0, reward_month: null, rewarded_at: null, skip_reason: null, created_at: iso(4), revoked_at: null },
    { id: "r3", inviter_expiry: null, invitee_user_id: "f3", invitee_email: "joy.reyes@gmail.com", inviter_user_id: "x", inviter_email: "lheyukay@gmail.com", inviter_code: "LHEY", source: "signup", status: "no_reward", reward_days: 0, reward_month: monthStart(0), rewarded_at: iso(12), skip_reason: "inviter_not_paid", created_at: iso(14), revoked_at: null },
  ] },
  my_feature_access: { buyer_contact: true, parcel_check: true, fm_pickup: true },
  my_parcel_tracking_access: true,
  parcel_check_can_use: true,
  session_status: { running: false, session_id: null, platform: null },
  my_session_summaries: [{ session_id: "past-1", first_day: day(-9), last_day: day(-8), orders: 2, latest: `${day(-8)}T05:00:00.000Z` }],
  parcel_tracking_status: { enabled: true, last_manual_check_at: null, last_completed_at: iso(0.2), job: null },
};

// Shopee for every seller previews (sql/206, docs/design/shopee-public):
//   ?shp=<on|off>,<none|active|ended>,<basic|free|expired>,<PH|TW|VN>[,shop]
//   = the switch shopee_public_enabled, the seller's beta row, the plan, the market, and (shop) one registered
//   Shopee shop. Account limits v2 is on (as in production). Absent = nothing below is touched.
const SHP = (/[?&]shp=([\w,]+)/.exec(Q) || [])[1] || "";
if (SHP) {
  const [pub, beta, plan, country, shop] = SHP.split(",");
  tables.app_settings.push({ key: "shopee_account_enforce", value: "true" }, { key: "shopee_public_enabled", value: pub === "on" ? "true" : "false" });
  Object.assign(tables.seller_profiles[0], {
    plan: plan === "free" ? "free" : "plus", plan_status: plan === "expired" ? "expired" : "active",
    plan_expiry: plan === "expired" ? iso(3) : plan === "free" ? null : "2027-12-31", country: country || "PH", tiktok: "budgetukay.ph",
  });
  RPC.my_shopee_beta = beta === "active" ? [{ expires_at: new Date(now + 12 * 86_400_000 - 60_000).toISOString(), shopee_uid: null }]
    : beta === "ended" ? [{ expires_at: iso(2), shopee_uid: null }] : null;
  RPC.session_status = { running: true, session_id: "preview-session", session_platform: null };
  const accounts: Row[] = [{ platform: "tiktok", key: "budgetukay.ph", id: null, name: null, link: false, rank: 1, covered: true, added_at: iso(40), lock_until: null }];
  if (shop) accounts.push({ platform: "shopee", key: "ph:000000005678", id: "s5678", name: null, link: true, rank: 2, covered: true, added_at: iso(1), lock_until: null });
  const limit = plan === "free" ? 1 : 2;
  RPC.my_account_list = { v2: true, plan: plan === "free" ? "free" : "plus", limit, unlimited: false, used: accounts.length, locked: 0, next_free_at: null, now: new Date(now).toISOString(), accounts };
  RPC.account_quota = { used: accounts.length, limit, unlimited: false, locked: 0, next_free_at: null };
}

// Free plan: no 4-hour account lock previews (sql/216, docs/design/free-no-account-lock):
//   ?fnl=free   what the database answers for a free seller: no wait on the TikTok username
//   ?fnl=paid   a paid seller who changed the username 30 minutes ago: "Unlock in 3h 30m"
const FNL = (/[?&]fnl=(\w+)/.exec(Q) || [])[1] || "";
if (FNL) {
  RPC.tiktok_slot_cooldowns = FNL === "paid"
    ? [{ platform: "tiktok", slot_index: 0, last_changed_at: new Date(now - 30 * 60_000).toISOString(), server_now: new Date(now).toISOString() }]
    : [];
  RPC.touch_tiktok_slot = new Date(now).toISOString();
}

// Free orders per live account previews (sql/208, docs/design/free-account-cap):
//   ?fac=1          a FREE login with no TikTok name; saving the username "usedshop" is refused by the
//                   "database" (free_account_used) — any other name saves.
//   ?fac=1&admin=1  the Admin list "Free sharing" with made-up logins.
const FAC = /[?&]fac=1\b/.test(Q);
if (FAC && !/[?&]admin=1\b/.test(Q)) Object.assign(tables.seller_profiles[0], { plan: "free", plan_expiry: null, tiktok: "", country: "PH" });
if (FAC) {
  const login = (n: number, email: string, plan: string, free: number) => ({ user_id: `fs-${n}`, email, plan, free_orders: free, created_at: iso(60 - n) });
  RPC.admin_free_sharing = { cap: 150, enforce: false,
    accounts: [
      { platform: "tiktok", account_key: "usedshop", label: "usedshop", account_orders: 193, logins: [login(1, "first.login@example.com", "free", 150), login(2, "second.login@example.com", "free", 38), login(3, "third.login@example.com", "free", 5)] },
      { platform: "tiktok", account_key: "ukay.daily", label: "ukay.daily", account_orders: 64, logins: [login(4, "owner@example.com", "pro", 22), login(5, "helper@example.com", "free", 42)] },
      { platform: "facebook", account_key: "100200300", label: "Budget Ukay Page", account_orders: 17, logins: [login(6, "page.one@example.com", "free", 9), login(7, "page.two@example.com", "free", 8)] },
    ],
    devices: [{ device: "sf-17322", logins: [login(1, "first.login@example.com", "free", 150), login(2, "second.login@example.com", "free", 38)] }],
    would_refuse: [{}, {}, {}, {}] };
  RPC.admin_free_account_reset = { ok: true, was: 193 };
}

// Receipt add-on previews (sql/223, docs/design/fb-addon-lock): ?ra=1&admin=1 — made-up sellers and the
// Admin "Receipt add-on" list (shop, email, plan, plan end, since, note). Never shipped.
if (/[?&]ra=1\b/.test(Q)) {
  const seller = (n: number, email: string, shop: string, plan: string, endsIn: number | null) => ({
    auth_user_id: `ra-${n}`, email, full_name: shop, store_name: shop, phone: "", tiktok: "", facebook: "", admin_contact_note: "", country: "TW",
    plan, plan_status: "active", plan_expiry: endsIn == null ? null : new Date(now + endsIn * 86_400_000).toISOString(), trial_started_at: null, connected_accounts: [], role: "seller", created_at: iso(90 - n),
  });
  const extra = [
    seller(1, "lia.closet@example.com", "Lia Closet", "pro", 41),
    seller(2, "ben.shop@example.com", "Ben's Ukay Corner", "plus", 3),
    seller(3, "cy.wholesale.long.name@example.com", "", "basic", -2),
    seller(4, "dee.store@example.com", "Dee Store", "basic", 18),
    seller(5, "mika.thrift@example.com", "Mika Thrift", "master", null),
  ];
  tables.seller_profiles.push(...extra);
  const addon = (r: Row, since: number, note: string | null) => ({ user_id: r.auth_user_id, email: r.email, shop: r.store_name || null, plan: r.plan, plan_status: "active", plan_expiry: r.plan_expiry, since: iso(since), note });
  RPC.admin_receipt_addon_list = [addon(extra[1], 6, null), addon(extra[2], 20, "trial week"), addon(extra[0], 52, "paid in chat · Nov"), addon(extra[4], 80, "owner friend")];
  RPC.admin_receipt_addon_set = { ok: true, result: "added" };
  RPC.admin_receipt_addon_note = { ok: true };
}

// Admin → Free tier previews (sql/228, docs/design/free-tier-active): ?ft=1&admin=1 — made-up free sellers
// (three look-alike "budgetukay" accounts, one finished, several with no order) + their last order times.
if (/[?&]ft=1\b/.test(Q)) {
  const H = 3_600_000;
  const free = (n: number, email: string, shop: string, tiktok: string, used: number, joinedDaysAgo: number, lastAgoMs: number | null) => ({ n, email, shop, tiktok, used, joinedDaysAgo, lastAgoMs });
  const list = [
    free(1, "budget.ukay@example.com", "Budget Ukay", "budgetukay1", 34, 40, 2 * H),
    free(2, "ukay.second@example.com", "", "budget_ukay2", 150, 25, 3 * 24 * H),
    free(3, "ukay.fourth@example.com", "", "budgetukay4", 0, 2, null),
    free(4, "mika.thrift@example.com", "Mika Thrift Corner", "mikathrift", 88, 60, 20 * 60_000),
    free(5, "lia.closet@example.com", "Lia Closet", "lia.closet", 12, 33, 5 * 24 * H),
    free(6, "dee.store@example.com", "Dee Store", "deestore", 150, 70, 12 * 24 * H),
    free(7, "rose.preloved@example.com", "Rose Preloved PH", "rosepreloved", 3, 9, 30 * H),
    free(8, "new.seller@example.com", "New Seller", "newseller", 0, 1, null),
    free(9, "fresh.start@example.com", "Fresh Start Shop", "freshstart", 0, 5, null),
  ];
  tables.seller_profiles.push(...list.map((f) => ({
    auth_user_id: `ft-${f.n}`, email: f.email, full_name: f.shop, store_name: f.shop, phone: "", tiktok: f.tiktok, facebook: "", admin_contact_note: "", country: f.n === 7 ? "PH" : "TW",
    plan: "free", plan_status: "active", plan_expiry: null, trial_started_at: null, connected_accounts: [], role: "seller", created_at: iso(f.joinedDaysAgo),
  })));
  RPC.list_free_users_status = list.map((f) => ({ email: f.email, store_name: f.shop, full_name: f.shop, count: f.used, cap: 150, near_cap: f.used >= 110, capped: f.used >= 150, cycle_resets_in_days: null }));
  RPC.admin_free_tier_activity = list.map((f) => ({ email: f.email, last_order_at: f.lastAgoMs == null ? null : new Date(now - f.lastAgoMs).toISOString() }));
}

// Admin → Live Pulse previews (docs/design/pulse-tile): ?pulse=1 — made-up activity for the Live Pulse panel.
if (/[?&]pulse=1\b/.test(Q)) {
  RPC.admin_business_pulse = {
    ok: true, generated_at: new Date(now).toISOString(),
    summary: { active_15m: 7, active_60m: 11, orders_60m: 184, orders_today: 2316, active_today: 23 },
    hourly: [8, 9, 10, 11, 12, 13, 14].map((hr, i) => ({ hr, orders: [40, 120, 260, 310, 280, 330, 184][i] })),
    sellers: [
      { store_name: "Lia Closet", email: "lia.closet@example.com", orders_today: 412, orders_60m: 38, last_order_at: new Date(now - 60_000).toISOString() },
      { store_name: "Mika Thrift Corner", email: "mika.thrift@example.com", orders_today: 301, orders_60m: 22, last_order_at: new Date(now - 240_000).toISOString() },
      { store_name: "Dee Store", email: "dee.store@example.com", orders_today: 96, orders_60m: 0, last_order_at: new Date(now - 7_200_000).toISOString() },
    ],
  };
}

// Admin → Printer testers → Printer list (sql/229, docs/design/printer-list-lock): ?ptl=1&admin=1 — today's
// approved printer names (the 11 active ones Locked), one Testing printer and one removed duplicate, and a clean
// test report whose Approve answers prefix_overlaps_locked (the message under the name).
if (/[?&]ptl=1\b/.test(Q)) {
  const rows: [string, string, string, string, string, boolean, boolean][] = [
    ["Printer_", "Printer_5E93_BLE", "Printer_5E93_BLE", "tspl", "0.0", false, true], ["4B-2054N", "4B-2054N", "4B-2054N", "tspl", "0.0", false, true],
    ["BlueTooth Printer", "BlueTooth Printer", "BlueTooth Printer", "tspl", "0.0", false, true], ["AE241-BT", "Aiyin", "AE241-BT_B57A-LE", "tspl", "0.0", false, true],
    ["VOZY U9", "VOZY U9", "VOZY U9", "tspl", "0.0", false, true], ["XP-460B", "Xprinter", "XP-460B", "tspl", "0.0", false, true],
    ["SK45_", "Kaysion", "SK45_5430L", "tspl", "0.0", false, true], ["XP-470B", "Other", "XP-470B", "tspl", "0.0", false, true],
    ["XP-470B", "Xprinter", "XP-470B", "tspl", "0.0", false, false], ["PT210L", "Other", "PT210L_30EF", "escpos", "0.0", false, true],
    ["D520", "Phomeno", "D520", "tspl", "0.0", false, true], ["CT221B", "Clabel", "CT221B", "tspl", "2.0", true, true],
  ];
  RPC.admin_approved_printers = [
    { id: "pv-t1", prefix: "HM-A300", brand: "Other", model: "HM-A300-1F2C", lang: "tspl", shift_mm: 0, flip: false, active: true, locked: false, approved_at: iso(1), report_id: null },
    ...rows.map(([prefix, brand, model, lang, shift, flip, active], i) => ({ id: `pv-a${i}`, prefix, brand, model, lang, shift_mm: shift, flip, active, locked: active, approved_at: iso(3 + i), report_id: null })),
  ];
  RPC.admin_printer_testers = [];
  RPC.admin_printer_test_reports = [{ id: "pv-r1", email: "tester@example.com", printer_name: "AE241-BT_C11D-LE", lang: "tspl", sticker_size: "50x30mm", send_ok: true, send_code: null, clean: true, photo_path: null, created_at: iso(0), ble_facts: {} }];
  RPC.admin_approve_printer = { __error: "prefix_overlaps_locked" };
  RPC.admin_lock_approved_printer = true;
}

// Invoicing previews (sql/220, docs/design/invoicing-tiktok): ?ivc=<buyers>,<sent> e.g. ?ivc=40,12
//   = the switch invoicing_enabled on, a running 2-day session with that many TikTok buyers (+ 2 Facebook
//   buyers, who are not in the TikTok list), the first <sent> saved as Sent, then one Next, one Not sent,
//   one "Can't message", one "New item" (sent before a later order), a number-only TikTok id further down,
//   and a saved format (payment note + shipping fee 38). Absent = nothing below is touched.
const IVC = (/[?&]ivc=(\d+),(\d+)/.exec(Q) || []).slice(1).map(Number);
// &fbsa=1 (FB-2 Send all, docs/design/fb-send-all): the running session gets a real session id (Send all needs
// one) and 4 more Facebook buyers; one of them is saved "Sent by hand" on the Facebook tab.
const FBSA = /[?&]fbsa=1/.test(Q);
const IVC_SESSION = FBSA ? "5e551011-0000-4000-8000-00000000fb2a" : "preview-invoice";
// &ivcplat=1 (docs/design/invoicing-session-platform): the running session is TikTok only, and two finished
// Facebook sessions exist (4 and 7 days ago) — each Invoicing tab lists its own platform's sessions.
const IVCPLAT = /[?&]ivcplat=1/.test(Q);
if (IVC.length === 2) {
  const [count, sent] = IVC;
  const NAMES = ["ana.cruz", "ben.t", "cara_shop", "dina.ukay", "ella.m", "faye88", "gina.lim", "hana_tw", "ivy.chen", "joy.reyes", "kim.dc", "lea.santos", "mia.go", "nina_p", "olive.tan", "pia.lopez", "queenie.w", "rica.m", "sam.yu", "tina.ong"];
  const ITEMS = [["A1 dress", 350], ["B2 top", 280], ["C3 bag", 120], ["D4 cap", 90], ["E5 belt", 60], ["F6 jeans", 420], ["G7 skirt", 260]] as const;
  const at = (n: number, extra = 0) => new Date(now - 26 * 3_600_000 + n * 9 * 60_000 + extra).toISOString();
  const rows: Row[] = [];
  const add = (n: number, handle: string, name: string, platform: string, item: readonly [string, number], t: string) =>
    rows.push({ id: 7000 + rows.length, user_id: UID, session_id: IVC_SESSION, session_date: t.slice(0, 10), created_at: t, buyer_number: n, handle, customer_name: name, platform, product: item[0], price: item[1], qty: 1, comment_msg_id: null, auto_code: null });
  for (let n = 1; n <= count; n++) {
    const base = NAMES[(n - 1) % NAMES.length];
    // &ivclong=1: buyer #2 gets a very long username (Invoicing row width checks)
    const handle = n === 18 ? "7234567890123456789" : n === 2 && /[?&]ivclong=1/.test(Q) ? "@a.very.long.tiktok.username.that_keeps_going_2026" : `@${base}${n > NAMES.length ? n : ""}`;
    const name = n === 18 ? "7234567890123456789" : base.replace(/[._]/g, " ");
    add(n, handle, name, "TikTok", ITEMS[n % ITEMS.length], at(n));
    if (n % 3 === 0) add(n, handle, name, "TikTok", ITEMS[(n + 2) % ITEMS.length], at(n, 4 * 60_000));
    if (n % 7 === 0) add(n, handle, name, "TikTok", ITEMS[(n + 4) % ITEMS.length], at(n, 20 * 3_600_000));   // again on day 2
  }
  if (!IVCPLAT) add(count + 1, "Maria Santos", "Maria Santos", "Facebook", ITEMS[0], at(count + 1));
  if (!IVCPLAT) add(count + 2, "Joy Reyes", "Joy Reyes", "Facebook", ITEMS[1], at(count + 2));
  if (FBSA && !IVCPLAT) {
    add(count + 3, "Lea Santos", "Lea Santos", "Facebook", ITEMS[2], at(count + 3));
    add(count + 3, "Lea Santos", "Lea Santos", "Facebook", ITEMS[3], at(count + 3, 5 * 60_000));
    add(count + 4, "Kim Dela Cruz", "Kim Dela Cruz", "Facebook", ITEMS[5], at(count + 4));
    add(count + 5, "Rica Mendoza", "Rica Mendoza", "Facebook", ITEMS[6], at(count + 5));
    add(count + 6, "Nina Perez", "Nina Perez", "Facebook", ITEMS[4], at(count + 6));
  }
  // two finished sessions for the session picker: a 2-day one (3 and 2 days ago, 14 TikTok buyers, the
  // first 5 saved as Sent) and a 1-day one (6 days ago, 6 buyers) — next to the 2-day "past-1" above
  const pastRows: Row[] = [];
  const addPast = (sid: string, n: number, daysAgo: number, item: readonly [string, number], minute = 0) => {
    const base = NAMES[(n + 6) % NAMES.length];
    const t = `${day(-daysAgo)}T0${5 + (minute >= 60 ? 1 : 0)}:${String(minute % 60).padStart(2, "0")}:00.000Z`;
    pastRows.push({ id: 8000 + pastRows.length, user_id: UID, session_id: sid, session_date: day(-daysAgo), created_at: t, buyer_number: n, handle: `@${base}`, customer_name: base.replace(/[._]/g, " "), platform: "TikTok", product: item[0], price: item[1], qty: 1, comment_msg_id: null, auto_code: null });
  };
  for (let n = 1; n <= 14; n++) { addPast("past-a", n, n <= 8 ? 3 : 2, ITEMS[n % ITEMS.length], n * 4); if (n % 4 === 0) addPast("past-a", n, 2, ITEMS[(n + 3) % ITEMS.length], 30 + n); }
  for (let n = 1; n <= 6; n++) addPast("past-b", n, 6, ITEMS[(n + 2) % ITEMS.length], n * 5);
  if (IVCPLAT) {
    const FBN = ["Maria Santos", "Joy Reyes", "Lea Santos", "Kim Dela Cruz", "Rica Mendoza", "Nina Perez"];
    const addFb = (sid: string, n: number, daysAgo: number, k: number) => {
      const t = `${day(-daysAgo)}T06:${String(n * 3 + k).padStart(2, "0")}:00.000Z`, item = ITEMS[(n + k) % ITEMS.length];
      pastRows.push({ id: 8500 + pastRows.length, user_id: UID, session_id: sid, session_date: day(-daysAgo), created_at: t, buyer_number: n, handle: FBN[n - 1], customer_name: FBN[n - 1], platform: "Facebook", product: item[0], price: item[1], qty: 1, comment_msg_id: null, auto_code: null });
    };
    for (let n = 1; n <= 6; n++) { addFb("5e5510f1-0000-4000-8000-0000000000f1", n, 4, 0); if (n % 2 === 0) addFb("5e5510f1-0000-4000-8000-0000000000f1", n, 4, 1); }
    for (let n = 1; n <= 3; n++) addFb("5e5510f2-0000-4000-8000-0000000000f2", n, 7, 0);
  }
  tables.live_session_orders.push(...rows, ...pastRows);
  // the list the database function answers: one line per session of this seller (as sql/128 groups)
  const groups = new Map<string, { session_id: string; first_day: string; last_day: string; orders: number; latest: string }>();
  for (const r of tables.live_session_orders as Row[]) {
    const sid = String(r.session_id), d = String(r.session_date), c = String(r.created_at);
    const g = groups.get(sid);
    if (!g) { groups.set(sid, { session_id: sid, first_day: d, last_day: d, orders: 1, latest: c }); continue; }
    if (d < g.first_day) g.first_day = d;
    if (d > g.last_day) g.last_day = d;
    if (c > g.latest) g.latest = c;
    g.orders += 1;
  }
  RPC.my_session_summaries = [...groups.values()];
  tables.app_settings.push({ key: "invoicing_enabled", value: "true" });
  tables.seller_session_config = [{ user_id: UID, current_session_id: IVC_SESSION, session_started_at: new Date(now - 26 * 3_600_000).toISOString(), session_window_days: 2, session_ended_at: null, window_days: 1, window_start: null }];
  tables.seller_receipt_settings = [{ user_id: UID, opening: "", note: "Pay by bank transfer within 24 hours.\nBank 012 · 0000-1234-5678", qr_image: null, invoice_shipping_fee: 38, updated_at: iso(3) }];
  RPC.session_status = { running: true, session_id: IVC_SESSION, session_platform: "TikTok" };
  // the saved status is made from the app's own rows (same buyer mark, same lines code) the first time it is read
  seedInvoiceSends = () => {
    const list = invoiceRows(rebuildSessionFromRows(rows as never).buyers, "tiktok", "");
    const morning = new Date(now); morning.setHours(9, 0, 0, 0);
    const row = (r: (typeof list)[number], i: number, status: string, hash = r.hash): Row => ({
      user_id: UID, session_key: IVC_SESSION, platform: "tiktok", buyer_number: r.num, buyer_key: r.key, status, lines_hash: hash,
      sent_at: status === "sent" ? new Date(morning.getTime() + i * 60_000).toISOString() : null,
    });
    tables.invoice_sends = [
      ...list.slice(0, sent).map((r, i) => row(r, i, "sent")),
      ...(list[sent + 2] ? [row(list[sent + 2], 0, "skipped")] : []),
      ...(list[sent + 3] ? [row(list[sent + 3], sent + 3, "sent", "before")] : []),
      // the 2-day past session: its first 5 buyers were sent
      ...invoiceRows(rebuildSessionFromRows(pastRows.filter((r) => r.session_id === "past-a") as never).buyers, "tiktok", "").slice(0, 5)
        .map((r, i) => ({ ...row(r, i, "sent"), session_key: "past-a" })),
      // &fbsa=1: the last Facebook buyer was sent by hand
      ...(FBSA ? invoiceRows(rebuildSessionFromRows(rows as never).buyers, "facebook", "").slice(-1).map((r) => ({ ...row(r, 0, "sent"), platform: "facebook" })) : []),
    ];
  };
}

type Filter = (r: Row) => boolean;
const cmp = (a: unknown, b: unknown): number => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

class Query implements PromiseLike<Res> {
  private filters: Filter[] = [];
  private orders: { k: string; asc: boolean }[] = [];
  private from_ = 0;
  private to_ = Infinity;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private head = false;
  private one: "single" | "maybe" | null = null;
  private payload: Row | Row[] | null = null;
  private table: string;
  constructor(table: string) { this.table = table; }
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this; }
  in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  is(k: string, v: unknown) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this; }
  not(k: string, op: string, v: unknown) { if (op === "is") this.filters.push((r) => (v === null ? r[k] != null : r[k] !== v)); return this; }
  gte(k: string, v: unknown) { this.filters.push((r) => cmp(r[k], v) >= 0); return this; }
  lte(k: string, v: unknown) { this.filters.push((r) => cmp(r[k], v) <= 0); return this; }
  gt(k: string, v: unknown) { this.filters.push((r) => cmp(r[k], v) > 0); return this; }
  lt(k: string, v: unknown) { this.filters.push((r) => cmp(r[k], v) < 0); return this; }
  ilike() { return this; }
  or() { return this; }
  order(k: string, opts?: { ascending?: boolean }) { this.orders.push({ k, asc: opts?.ascending !== false }); return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  limit(n: number) { this.from_ = 0; this.to_ = n - 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  insert(p: Row | Row[]) { this.mode = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[]) { this.mode = "insert"; this.payload = p; return this; }
  update(p: Row) { this.mode = "update"; this.payload = p; return this; }
  delete() { this.mode = "delete"; return this; }
  private run(): Res {
    if (this.table === "invoice_sends" && seedInvoiceSends) { const seed = seedInvoiceSends; seedInvoiceSends = null; seed(); }
    if (this.table === "invoice_sends" && this.mode === "insert") {   // the app's upsert: one row per buyer, the time is the database's
      const p = (Array.isArray(this.payload) ? this.payload[0] : this.payload) ?? {};
      tables.invoice_sends = (tables.invoice_sends ?? []).filter((r) => !(r.session_key === p.session_key && r.platform === p.platform && r.buyer_number === p.buyer_number && r.buyer_key === p.buyer_key));
      this.payload = { ...p, sent_at: p.status === "sent" ? new Date().toISOString() : null };
    }
    if (this.table === "seller_receipt_settings" && this.mode === "insert") {   // the app's upsert: only the columns sent change
      const p = (Array.isArray(this.payload) ? this.payload[0] : this.payload) ?? {};
      const old = (tables.seller_receipt_settings ?? []).find((r) => r.user_id === p.user_id);
      tables.seller_receipt_settings = (tables.seller_receipt_settings ?? []).filter((r) => r !== old);
      this.payload = { ...(old ?? {}), ...p };
    }
    const all = tables[this.table] ?? (tables[this.table] = []);
    if (FAC && this.table === "seller_profiles" && this.mode !== "select" && this.mode !== "delete"
      && [this.payload].flat().some((r) => /usedshop/i.test(String((r as Row | null)?.tiktok ?? "")))) {
      return { data: null, error: { message: "free_account_used" }, count: null } as unknown as Res;
    }
    if (this.mode === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map((r) => ({ id: `n${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      all.unshift(...rows);
      return { data: this.one ? rows[0] : rows, error: null, count: rows.length };
    }
    const hit = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") { for (const r of hit) Object.assign(r, this.payload); return { data: this.one ? hit[0] ?? null : hit, error: null, count: hit.length }; }
    if (this.mode === "delete") { tables[this.table] = all.filter((r) => !hit.includes(r)); return { data: hit, error: null, count: hit.length }; }
    const sorted = [...hit].sort((a, b) => { for (const o of this.orders) { const c = cmp(a[o.k], b[o.k]); if (c) return o.asc ? c : -c; } return 0; });
    const page = sorted.slice(this.from_, this.to_ + 1);
    if (this.head) return { data: null, error: null, count: hit.length };
    if (this.one) return { data: page[0] ?? null, error: null, count: hit.length };
    return { data: page, error: null, count: hit.length };
  }
  then<T1 = Res, T2 = never>(res?: ((v: Res) => T1 | PromiseLike<T1>) | null, rej?: ((e: unknown) => T2 | PromiseLike<T2>) | null): Promise<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(res ?? undefined, rej ?? undefined);
  }
}

const ANON = typeof location !== "undefined" && /[?&]anon=1\b/.test(location.search); // ?anon=1 = signed out (Sign-up previews)
const session = { user: { id: UID, email: EMAIL }, access_token: "preview", expires_at: Math.floor(now / 1000) + 86_400 };
type AuthCb = (event: string, s: typeof session | null) => void;
const fakeClient = {
  from: (table: string) => new Query(table),
  // an RPC whose preview value is { __error: "word" } answers that database error (preview-only)
  rpc: (name: string) => ({ then: (res?: (v: Res) => unknown) => {
    const v = RPC[name] as { __error?: string } | undefined;
    const e = v && typeof v === "object" && typeof v.__error === "string" ? { message: v.__error } : null;
    return Promise.resolve({ data: e ? null : v ?? null, error: e, count: null } as Res).then(res);
  } }),
  auth: {
    getSession: async () => ({ data: { session: ANON ? null : session }, error: null }),
    getUser: async () => ({ data: { user: session.user }, error: null }),
    onAuthStateChange: (cb: AuthCb) => { if (!ANON) setTimeout(() => cb("SIGNED_IN", session), 0); return { data: { subscription: { unsubscribe: () => undefined } } }; },
    signInWithPassword: async () => ({ data: { session }, error: null }),
    signUp: async () => ({ data: { session }, error: null }),
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session }, error: null }),
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined, unsubscribe: () => undefined }),
  removeChannel: () => undefined,
};

export const supabaseConfigHint = "preview:fake";
export const isSupabaseConfigured = true;
// The real module's type is the supabase-js client; the app only calls the surface above.
export const supabase = fakeClient as unknown as import("@supabase/supabase-js").SupabaseClient;
