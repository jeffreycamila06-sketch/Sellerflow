// Fake Supabase client for the screenshot harness: an in-memory parcel_tracking table + the few
// RPCs Pickup Status calls. Same answers for the TODAY (main) and NEW (branch) screens.
// ?scene=counts|toast|sync  ?today=1 → model today's database (a Sync queues a check job).
const q = new URLSearchParams(location.search);
const scene = q.get("scene") || "counts";
const todayDb = q.get("today") === "1";
const DAY = 86400000;
const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
const ymd = (days: number) => new Date(Date.now() + days * DAY + 8 * 3600000).toISOString().slice(0, 10);
let n = 0;
const row = (o: Record<string, unknown>) => ({
  id: `r${++n}`, user_id: "U1", tracking_no: `F8${String(36700000 + n).padStart(8, "0")}`, cm_order_no: null, buyer_username: null,
  recipient_name: null, store_id: null, rec_store: null, status: "created", status_message: null, pickup_deadline: null,
  arrived_at: null, ship_type: null, special_type: null, order_amount: null, terminal: false, last_polled_at: null,
  carrier: "711", created_at: iso(3 * DAY), returned_at: null, picked_up_at: null, ...o,
});
const seven = { ship_type: "C2C", special_type: null };
const ROWS: Record<string, unknown>[] = [];
if (scene === "counts" || scene === "sync") {
  ROWS.push(
    row({ ...seven, status: "at_store", buyer_username: "maria_shop", rec_store: "中壢華強", pickup_deadline: ymd(1), order_amount: 450, last_polled_at: iso(3600000), status_message: "包裹配達取件門市" }),
    row({ ...seven, status: "at_store", buyer_username: "lovely.ann", rec_store: "朝陽", pickup_deadline: ymd(3), order_amount: 280, last_polled_at: iso(3600000), status_message: "包裹配達取件門市" }),
    row({ ...seven, status: "at_store", buyer_username: "joy_ukay", rec_store: "新竹光復", pickup_deadline: ymd(5), order_amount: 620, last_polled_at: iso(3600000), status_message: "包裹配達取件門市" }),
    row({ ...seven, status: "in_transit", buyer_username: "chen_88", order_amount: 350, last_polled_at: iso(3600000), status_message: "包裹進行配送中" }),
    row({ ...seven, status: "in_transit", buyer_username: "rosie_tw", order_amount: 199, last_polled_at: iso(3600000), status_message: "寄件門市已收件" }),
    row({ ...seven, status: "picked_up", buyer_username: "kyle_b", rec_store: "板橋", order_amount: 500, picked_up_at: iso(DAY), status_message: "已完成包裹取件" }),
    row({ ...seven, status: "returned", buyer_username: "noshow01", rec_store: "台中大里", order_amount: 300, returned_at: iso(2 * DAY), status_message: "包裹已送達退貨門市" }),
  );
}
if (scene === "counts" || scene === "toast") { // toast: ONLY just-synced parcels → a press finds nothing checkable
  for (const [u, ago] of [["anna.lim", 2 * 3600000], ["bea_closet", 5 * 3600000], ["carla88", 20 * 3600000], ["dina_pre", 26 * 3600000]] as const)
    ROWS.push(row({ buyer_username: u, created_at: iso(ago) })); // synced today / yesterday, never checked
}
type Filter = (r: Record<string, unknown>) => boolean;
class Query {
  private filters: Filter[] = [];
  private countMode = false; private headOnly = false; private lim = Infinity; private from_ = 0; private to = Infinity;
  private orders: [string, boolean][] = [];
  private op: "select" | "upsert" = "select"; private payload: Record<string, unknown>[] = [];
  constructor(private table: string) {}
  select(_c?: string, o?: { count?: string; head?: boolean }) { this.countMode = !!o?.count; this.headOnly = !!o?.head; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  not(c: string, _op: string, _v: unknown) { this.filters.push((r) => r[c] != null); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  or(expr: string) {
    if (expr.startsWith("special_type")) this.filters.push((r) => r.special_type == null || r.special_type === "");
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
  range(a: number, b: number) { this.from_ = a; this.to = b; return this; }
  limit(n: number) { this.lim = n; return this; }
  upsert(rows: Record<string, unknown>[]) { this.op = "upsert"; this.payload = rows; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (this.table !== "parcel_tracking") return { data: [], error: null, count: 0 };
    if (this.op === "upsert") {
      for (const p of this.payload) if (!ROWS.some((r) => r.tracking_no === p.tracking_no)) ROWS.push(row({ ...p, created_at: iso(60000) }));
      synced = true;
      return { data: null, error: null };
    }
    let list = ROWS.filter((r) => this.filters.every((f) => f(r)));
    for (const [c, asc] of [...this.orders].reverse()) list = [...list].sort((a, b) => {
      const x = a[c] ?? null, y = b[c] ?? null;
      if (x === y) return 0; if (x === null) return 1; if (y === null) return -1;
      return (x < y ? -1 : 1) * (asc ? 1 : -1);
    });
    const count = list.length;
    list = list.slice(this.from_, this.to === Infinity ? undefined : this.to + 1).slice(0, this.lim);
    return { data: this.headOnly ? null : list, error: null, count: this.countMode ? count : null };
  }
}
let synced = false;
let statusReads = 0;
const status = () => {
  statusReads += 1;
  const base = { last_completed_at: iso(13 * 3600000), last_manual_check_at: iso(13 * 3600000), next_available_at: null, used_today: false, urgent_used_today: false, active_job: null, last_job: null };
  if (scene === "toast") {
    return statusReads <= 1
      ? { ...base, active_job: { id: "j", kind: "manual", status: "running", requested_at: iso(5000) } }
      : { ...base, last_job: { id: "j", kind: "manual", status: "done", error: null, parcels_checked: 0, parcels_total: 0, finished_at: iso(1000) } };
  }
  if (scene === "sync" && synced && todayDb) return { ...base, active_job: { id: "j", kind: "new_parcels", status: "queued", requested_at: iso(1000) } };
  return base;
};
export const isSupabaseConfigured = true;
export const supabaseConfigHint = "fake";
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "U1" }, access_token: "t" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: (t: string) => new Query(t),
  rpc: async (fn: string) => {
    if (fn === "parcel_tracking_status") return { data: status(), error: null };
    if (fn === "parcel_tracking_foreign_overlap") return { data: 0, error: null };
    if (fn === "parcel_tracking_auto_check") return { data: { ok: false, reason: "not_listed" }, error: null };
    if (fn === "my_parcel_tracking_access") return { data: true, error: null };
    return { data: null, error: null };
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
export default supabase;
