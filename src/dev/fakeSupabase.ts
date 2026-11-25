// PREVIEW-ONLY fake Supabase (never shipped). `vite.preview.config.ts` aliases every import of
// `src/supabase.ts` to this module, so the REAL app and REAL screens run against an in-memory
// database seeded for screenshots (docs/design/*): no network, no sign-in, no live columns
// needed. The query builder covers the PostgREST calls the app makes at load (select / eq /
// neq / in / is / not / gte / lte / order / range / limit / single / maybeSingle / head
// counts, insert / update / delete) — anything else resolves to empty data, never an error.
//   npx vite --config vite.preview.config.ts --port 5199
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
const monthStart = (add: number) => { const d = new Date(now + 8 * 3_600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1)).toISOString().slice(0, 10); };
// ?quota=used,limit,locked → the "Accounts used: x of y" line (docs/design/account-limits-v2); absent = no line.
const QUOTA = typeof location !== "undefined" ? new URLSearchParams(location.search).get("quota") : null;
const quotaAnswer = (): unknown => {
  if (!QUOTA) return null;
  const [used, limit, locked] = QUOTA.split(",").map(Number);
  return { used, limit, unlimited: false, locked: locked || 0, next_free_at: null };
};
const RPC: Record<string, unknown> = {
  account_quota: quotaAnswer(),
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
  rpc: (name: string) => ({ then: (res?: (v: Res) => unknown) => Promise.resolve({ data: RPC[name] ?? null, error: null, count: null } as Res).then(res) }),
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
