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
    plan_expiry: "2027-12-31", trial_started_at: null, connected_accounts: [], role: "seller", created_at: iso(200),
  }],
  app_settings: [
    { key: "parcel_manual_enabled", value: "true" }, { key: "buyer_contact_enabled", value: "true" },
    { key: "fm_scan_enabled", value: "true" }, { key: "fm_pickup_enabled", value: "true" },
    { key: "fm_shipping_fee", value: "39" }, { key: "shipping_fee_global", value: "38" },
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
  ],
  fm_parcel_scans: [
    { id: "f1", user_id: UID, recipient_name: "黃志明", phone: "0911222333", store_id: "022131", amount: 450, shipping_fee: 39, order_date: day(0), buyer_username: "+886911222333", contact_platform: "whatsapp", created_at: iso(0.3), exported_at: null, export_batch_id: null },
  ],
  fm_parcel_customers: [
    { id: "fc1", user_id: UID, phone: "0911222333", name: "黃志明", store_id: "022131", buyer_username: "+886911222333", contact_platform: "whatsapp", created_at: iso(5), updated_at: iso(0.3) },
  ],
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
const RPC: Record<string, unknown> = {
  my_feature_access: { buyer_contact: true, parcel_check: true, fm_pickup: true },
  my_parcel_tracking_access: true,
  parcel_check_can_use: true,
  session_status: { running: false, session_id: null, platform: null },
  parcel_tracking_status: { enabled: true, last_manual_check_at: null, last_completed_at: iso(0.2), job: null },
};

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

const session = { user: { id: UID, email: EMAIL }, access_token: "preview", expires_at: Math.floor(now / 1000) + 86_400 };
type AuthCb = (event: string, s: typeof session | null) => void;
const fakeClient = {
  from: (table: string) => new Query(table),
  rpc: (name: string) => ({ then: (res?: (v: Res) => unknown) => Promise.resolve({ data: RPC[name] ?? null, error: null, count: null } as Res).then(res) }),
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: session.user }, error: null }),
    onAuthStateChange: (cb: AuthCb) => { setTimeout(() => cb("SIGNED_IN", session), 0); return { data: { subscription: { unsubscribe: () => undefined } } }; },
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
