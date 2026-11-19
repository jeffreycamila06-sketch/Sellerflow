// Fake Supabase client for the screenshot harness: an in-memory parcel_tracking table (7-11 and
// 全家 rows) + the few RPCs Pickup Status calls. The SAME rows for the BEFORE (main) and AFTER
// (branch) screens. Every name, number and store below is made up.
// The 全家 rows carry ship_type "全家店寄店取" — what 70 of the 76 live 全家 rows carry (2026-11-19) —
// except one saved as "C2C" (the older 好賣+ file).
const DAY = 86400000;
const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
const ymd = (days: number) => new Date(Date.now() + days * DAY + 8 * 3600000).toISOString().slice(0, 10);
let n = 0;
const row = (o: Record<string, unknown>) => ({
  id: `r${String(++n).padStart(3, "0")}`, user_id: "U1", tracking_no: `F8${String(36700000 + n).padStart(8, "0")}`, cm_order_no: null, buyer_username: null,
  recipient_name: null, store_id: null, rec_store: null, status: "created", status_message: null, pickup_deadline: null,
  arrived_at: null, ship_type: null, special_type: null, order_amount: null, terminal: false, last_polled_at: iso(2 * 3600000),
  carrier: "711", created_at: iso(3 * DAY), returned_at: null, picked_up_at: null, ...o,
});
const seven = { ship_type: "C2C", special_type: null, carrier: "711" };
const fm = (o: Record<string, unknown>) => row({ carrier: "fm", ship_type: "全家店寄店取", tracking_no: `1635174${String(6600 + n)}`, cm_order_no: `G26B19T${String(100 + n)}`, ...o });
const ROWS: Record<string, unknown>[] = [
  // 7-11: 2 waiting · 1 in transit · 1 picked up
  row({ ...seven, status: "at_store", buyer_username: "maria_shop", rec_store: "中壢華強", pickup_deadline: ymd(4), order_amount: 450, status_message: "包裹配達取件門市" }),
  row({ ...seven, status: "at_store", buyer_username: "joy_ukay", rec_store: "新竹光復", pickup_deadline: ymd(6), order_amount: 620, status_message: "包裹配達取件門市" }),
  row({ ...seven, status: "in_transit", buyer_username: "chen_88", rec_store: "朝陽", order_amount: 350, status_message: "包裹進行配送中" }),
  row({ ...seven, status: "picked_up", terminal: true, buyer_username: "kyle_b", rec_store: "板橋", order_amount: 500, picked_up_at: iso(DAY), status_message: "已完成包裹取件" }),
  // 全家 (全家店寄店取): 3 waiting · 1 moving · 2 not dropped off yet · 2 picked up
  fm({ status: "at_store", buyer_username: "anna.lim", store_id: "022131", rec_store: "樹林新柑園店", pickup_deadline: ymd(1), order_amount: 339, status_message: "貨件配達取件店舖" }),
  fm({ status: "at_store", buyer_username: "bea_closet", store_id: "017845", rec_store: "板橋文化店", pickup_deadline: ymd(3), order_amount: 580, status_message: "貨件配達取件店舖" }),
  fm({ status: "at_store", buyer_username: "carla88", store_id: "009913", rec_store: "台中逢甲店", pickup_deadline: ymd(5), order_amount: 260, status_message: "貨件配達取件店舖" }),
  fm({ status: "in_transit", buyer_username: "dina_pre", store_id: "013377", rec_store: "高雄三多店", order_amount: 199, status_message: "貨件進行配送中" }),
  fm({ status: "in_transit", buyer_username: "ella.tw", store_id: "020418", rec_store: "新莊中正店", pickup_deadline: ymd(9), order_amount: 420, status_message: "出貨中" }),
  fm({ status: "in_transit", buyer_username: "faye_ukay", store_id: "015502", rec_store: "桃園中山店", pickup_deadline: ymd(2), order_amount: 310, status_message: "出貨中" }),
  fm({ status: "picked_up", terminal: true, buyer_username: "gina_b", store_id: "011209", rec_store: "台南成功店", order_amount: 700, picked_up_at: iso(DAY), status_message: "已完成取件" }),
  fm({ status: "picked_up", terminal: true, buyer_username: "hana.shop", store_id: "018830", rec_store: "基隆仁愛店", order_amount: 150, picked_up_at: iso(2 * DAY), status_message: "已完成取件" }),
  // 全家, saved as C2C (the older file: 常溫店到店)
  fm({ ship_type: "C2C", status: "in_transit", buyer_username: "ivy_live", store_id: "022131", rec_store: "樹林新柑園店", pickup_deadline: ymd(11), order_amount: 280, status_message: "出貨中" }),
];
type Filter = (r: Record<string, unknown>) => boolean;
class Query {
  private filters: Filter[] = [];
  private countMode = false; private headOnly = false; private lim = Infinity; private from_ = 0; private to = Infinity;
  private orders: [string, boolean][] = [];
  constructor(private table: string) {}
  select(_c?: string, o?: { count?: string; head?: boolean }) { this.countMode = !!o?.count; this.headOnly = !!o?.head; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  not(c: string, _op: string, _v: unknown) { this.filters.push((r) => r[c] != null); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  or(expr: string) {
    const empty = (v: unknown) => v == null || v === "";
    if (expr.startsWith("special_type")) this.filters.push((r) => empty(r.special_type));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
  range(a: number, b: number) { this.from_ = a; this.to = b; return this; }
  limit(k: number) { this.lim = k; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (this.table !== "parcel_tracking") return { data: [], error: null, count: 0 };
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
const status = () => ({ last_completed_at: iso(13 * 3600000), last_manual_check_at: iso(13 * 3600000), next_available_at: null, used_today: false, urgent_used_today: false, active_job: null, last_job: null });
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
