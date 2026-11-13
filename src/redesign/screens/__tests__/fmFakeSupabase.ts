// A recording stand-in for the Supabase client (tests of Parcel Scan FamilyMart). Every call
// chain on a table is kept with its method names and arguments, so a test can prove which
// columns were read / written. fm_parcel_scans behaves like a tiny table (fake.rows).
export type FakeCall = { table: string; ops: { m: string; args: unknown[] }[] };
type Row = Record<string, unknown>;
export const fake = {
  calls: [] as FakeCall[],
  rows: [] as Row[],
  userId: "u1",
  getSession: (async () => ({ data: { session: { user: { id: "u1" }, access_token: "t" } } })) as () => Promise<unknown>,
  seq: 0,
  reset() { this.calls = []; this.rows = []; this.seq = 0; this.getSession = async () => ({ data: { session: { user: { id: this.userId }, access_token: "t" } } }); },
  // every column list and written key, as one text
  text(table = "fm_parcel_scans"): string { return JSON.stringify(this.calls.filter((c) => c.table === table)); },
  writes(table = "fm_parcel_scans"): Row[] {
    return this.calls.filter((c) => c.table === table && (c.ops[0]?.m === "update" || c.ops[0]?.m === "insert")).map((c) => c.ops[0].args[0] as Row);
  },
};
function resultOf(c: FakeCall): { data: unknown; error: null } {
  const first = c.ops[0];
  const single = c.ops.some((o) => o.m === "single" || o.m === "maybeSingle");
  if (c.table !== "fm_parcel_scans" || !first) return { data: single ? null : [], error: null };
  const eqId = c.ops.find((o) => o.m === "eq" && o.args[0] === "id")?.args[1];
  // like the database: only the columns asked for come back
  const pick = (r: Row, cols: unknown): Row => {
    const names = String(cols ?? "*").split(",").map((x) => x.trim());
    return names.includes("*") ? { ...r } : Object.fromEntries(names.filter((n) => n in r).map((n) => [n, r[n]]));
  };
  const back = c.ops.find((o) => o.m === "select")?.args[0];
  if (first.m === "select") return { data: fake.rows.map((r) => pick(r, back)), error: null };
  if (first.m === "insert") {
    const row: Row = { id: `new${++fake.seq}`, created_at: "2026-10-11T05:00:00Z", exported_at: null, export_batch_id: null, ...(first.args[0] as Row) };
    fake.rows.unshift(row);
    return { data: single ? pick(row, back) : [pick(row, back)], error: null };
  }
  if (first.m === "update") {
    const hit = fake.rows.filter((r) => (eqId === undefined ? true : r.id === eqId));
    hit.forEach((r) => Object.assign(r, first.args[0] as Row));
    return { data: single ? (hit[0] ? pick(hit[0], back) : null) : hit.map((r) => pick(r, back)), error: null };
  }
  return { data: single ? null : [], error: null };
}
function chain(table: string): unknown {
  const c: FakeCall = { table, ops: [] };
  fake.calls.push(c);
  const p: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resultOf(c)).then(res, rej);
      return (...args: unknown[]) => { c.ops.push({ m: String(prop), args }); return p; };
    },
  });
  return p;
}
export const fakeSupabaseModule = {
  isSupabaseConfigured: true,
  supabaseConfigHint: "test",
  supabase: { from: (table: string) => chain(table), auth: { getSession: () => fake.getSession() }, rpc: async () => ({ data: null, error: null }) },
};
