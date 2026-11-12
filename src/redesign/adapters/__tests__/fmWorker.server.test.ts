// The FamilyMart (全家) part inside the job worker (server/parcelTrackingWorker.js): the 7-11 part
// is FINISHED first, exactly as before; only then the 全家 part runs and adds its numbers in one
// small separate update. Nothing it does, or fails to do, changes what the 7-11 part wrote.
// (The unchanged 7-11 suite, parcelTrackingWorker.server.test.ts, runs with the 全家 switch off.)
import { describe, it, expect, vi } from "vitest";
import { createWorker, fmStampsLastChecked, fmKeepsPress, JOB_MAX_MS, FM_PART_MAX_MS } from "../../../../server/parcelTrackingWorker.js";
import { FM_PARCELS_PER_JOB, FM_JOB_MAX_MS } from "../../../../server/fmTrackingRunner.js";

const T0 = new Date("2026-11-12T02:00:00Z"); // 10:00 Taipei
const iso = (ms: number) => new Date(T0.getTime() - ms).toISOString();
const H = 60 * 60 * 1000;

type Row = Record<string, unknown>;
type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
type Cfg = { job?: Row | null; rows?: Row[]; settings?: Record<string, string>; fmRows?: Row[] };
// A service-role stand-in in the shape of the existing worker suite. parcel_tracking selects with
// carrier 'fm' return cfg.fmRows; the others return cfg.rows (the 7-11 rows).
function fakeSb(cfg: Cfg = {}) {
  const queries: Q[] = [];
  const rpcs: { name: string; args: Row }[] = [];
  const events: string[] = [];
  const resolve = (q: Q) => {
    events.push(`${q.table}.${q.op}`);
    const has = (k: string, ...v: unknown[]) => q.filters.some((f) => f[0] === k && v.every((x, i) => f[i + 1] === x));
    if (q.table === "app_settings") {
      const all: Record<string, string> = { parcel_tracking_enabled: "true", ...(cfg.settings ?? {}) };
      const keys = (q.filters.find((f) => f[0] === "in")?.[2] ?? Object.keys(all)) as string[];
      return { data: keys.filter((k) => k in all).map((key) => ({ key, value: all[key] })), error: null };
    }
    if (q.table === "seller_profiles") return { data: { plan: "plus", role: "seller", plan_status: "active", plan_expiry: null }, error: null };
    if (q.table === "parcel_tracking_daily") return { data: { requests: 0 }, error: null };
    if (q.table === "fm_tracking_daily") return { data: null, error: null };
    if (q.table === "parcel_tracking_jobs" && q.op === "select") return { data: [], error: null };
    if (q.table === "parcel_tracking" && q.op === "select") {
      if (q.filters.some((f) => f[0] === "is")) return { data: [], error: null };
      const r = q.filters.find((f) => f[0] === "range") as [string, number, number];
      return { data: (has("eq", "carrier", "fm") ? cfg.fmRows ?? [] : cfg.rows ?? []).slice(r[1], r[2] + 1), error: null };
    }
    if (q.op === "delete") return { data: [], error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [], patch: null };
    queries.push(q);
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(resolve(q)).then(f, r);
        return (...args: unknown[]) => {
          if (["update", "insert", "delete", "upsert"].includes(k)) { q.op = k; q.patch = args[0] ?? null; }
          else if (k !== "select" && k !== "maybeSingle") q.filters.push([k, ...args]);
          return ch;
        };
      },
    });
    return ch;
  };
  const rpc = (name: string, args: Row = {}) => {
    rpcs.push({ name, args });
    events.push(`rpc.${name}`);
    if (name === "parcel_tracking_claim_job") return Promise.resolve({ data: cfg.job ? [cfg.job] : [], error: null });
    return Promise.resolve({ data: "new-id", error: null });
  };
  return { from, rpc, queries, rpcs, events };
}
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const job = (kind: string, extra: Row = {}): Row =>
  ({ id: "J1", user_id: "U1", kind, status: "running", created_by: kind === "manual" || kind === "urgent" ? "seller" : kind === "auto" ? "auto" : "sync", requested_at: iso(60_000), started_at: iso(0), ...extra });
const row711 = (id: string, extra: Row = {}): Row => ({ id, user_id: "U1", tracking_no: `F${id}0000000`, status: "at_store", last_polled_at: null, created_at: iso(48 * H), ...extra });
const rowFm = (i: number, extra: Row = {}): Row => ({ id: `fm${i}`, user_id: "U1", carrier: "fm", tracking_no: String(16300000100 + i), status: "at_store", terminal: false, last_polled_at: iso(30 * H), created_at: iso(72 * H), pickup_deadline: null, ...extra });
const checkOk = () => vi.fn(async (a: { rows: unknown[] }) => ({ batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0, tripped: false, stopReason: null, sent: 3 }));
const fmResult = (over: Row = {}) => ({ ran: true, reason: null, total: 3, checked: 3, failed: false, requests: 21, ...over });

const jobUpdates = (sb: ReturnType<typeof fakeSb>) => sb.queries.filter((q) => q.table === "parcel_tracking_jobs" && q.op === "update").map((q) => q.patch as Row);
const jobPatch = (sb: ReturnType<typeof fakeSb>) => jobUpdates(sb)[0];
const accessUpdates = (sb: ReturnType<typeof fakeSb>) => sb.queries.filter((q) => q.table === "parcel_tracking_access" && q.op === "update").map((q) => q.patch as Row);
// Everything the worker did to the database, in order — "table.op" (+ the rpc names).
const trail = (sb: ReturnType<typeof fakeSb>) => sb.events.slice();
const healthRows = (sb: ReturnType<typeof fakeSb>) => sb.queries.filter((q) => q.table === "parcel_tracking_health").map((q) => q.patch as Row);
const strip = (r: Row) => { const { finished_at: _f, duration_ms: _d, ran_at: _r, ...rest } = r; return rest; };

async function runOne(cfg: Cfg, opts: Row = {}) {
  const sb = fakeSb(cfg);
  const check = checkOk();
  const emit = vi.fn();
  const logger = quiet();
  // a small fixed memory reading: the automatic check's memory guard never depends on the test machine
  const w = createWorker({ serviceSb: sb, now: () => T0, logger, emit, checkRowsImpl: check, memoryUsage: () => ({ rss: 50 * 1024 * 1024 }), ...opts });
  const out = await w.tick();
  return { sb, check, emit, logger, out };
}

describe("全家 off — the 7-11 job is what it was", () => {
  it("no fm_check_enabled row: ONE small settings read at the very END of the job, no 全家 row read, no 全家 request", async () => {
    const { sb, check, emit } = await runOne({ job: job("manual"), rows: [row711("a"), row711("b")] });
    const fmRead = sb.queries.findIndex((q) => q.table === "app_settings" && ((q.filters.find((f) => f[0] === "in")?.[2] ?? []) as string[]).includes("fm_check_enabled"));
    expect(fmRead).toBe(sb.queries.length - 1);               // the last thing the job does
    expect(sb.queries.some((q) => q.table === "parcel_tracking" && q.filters.some((f) => f[0] === "eq" && f[1] === "carrier" && f[2] === "fm"))).toBe(false);
    expect(sb.queries.some((q) => q.table === "fm_tracking_daily")).toBe(false);
    expect(sb.rpcs.some((r) => r.name === "fm_check_open_for")).toBe(false);
    expect(jobUpdates(sb).length).toBe(1);                    // no second update of the job row
    expect(emit).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("everything the 7-11 part writes is IDENTICAL with the 全家 part off, crashing, idle, or never coming back", async () => {
    const cfg = { job: job("manual"), rows: [row711("a"), row711("b")] };
    const off = await runOne(cfg);                                                                          // real 全家 part, switch off
    const crash = await runOne(cfg, { runFmImpl: async () => { throw new Error("boom"); } });
    const idle = await runOne(cfg, { runFmImpl: async () => ({ ran: false, reason: "nothing_due", total: 0, checked: 0, failed: false, requests: 0 }) });
    const hung = await runOne(cfg, { runFmImpl: () => new Promise(() => {}), fmPartMaxMs: 20 });           // never settles
    const seven = (t: string[]) => t.filter((e) => e !== "app_settings.select");                            // the 全家 gate read aside
    for (const other of [crash, idle, hung]) {
      expect(jobUpdates(other.sb).map(strip)).toEqual(jobUpdates(off.sb).map(strip));
      expect(healthRows(other.sb).map(strip)).toEqual(healthRows(off.sb).map(strip));
      expect(accessUpdates(other.sb).length).toBe(accessUpdates(off.sb).length);
      const pick = (c: ReturnType<typeof checkOk>) => { const a = c.mock.calls[0][0] as Row; return { rows: a.rows, requestBudget: a.requestBudget, deadlineAt: a.deadlineAt, limits: a.limits, tag: a.tag }; };
      expect(pick(other.check)).toEqual(pick(off.check));
      expect(other.emit.mock.calls).toEqual(off.emit.mock.calls);
      expect(seven(trail(other.sb))).toEqual(seven(trail(off.sb)));
      expect(other.out).toEqual(off.out);
    }
    expect(jobPatch(off.sb)).toMatchObject({ status: "done", error: null, parcels_total: 2, parcels_checked: 2, requests_used: 3 });
    expect(crash.logger.error.mock.calls.some((c) => String(c[0]).includes("FamilyMart part threw"))).toBe(true);
    expect(hung.logger.error.mock.calls.some((c) => String(c[0]).includes("FamilyMart part still running"))).toBe(true);
  });

  it("the 全家 part can hold the worker for at most its own time limit + 2 minutes", () => {
    expect(FM_PART_MAX_MS).toBe(FM_JOB_MAX_MS + 2 * 60 * 1000);
  });
});

describe("全家 on", () => {
  it("the 7-11 part is FINISHED first — job row, health row, last checked, message to the app — and only then the 全家 part starts", async () => {
    const order: string[] = [];
    const sb = fakeSb({ job: job("manual"), rows: [row711("a"), row711("b")] });
    const check = vi.fn(async (a: { rows: unknown[] }) => { order.push("711"); return { batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0, tripped: false, stopReason: null, sent: 3 }; });
    const emit = vi.fn(() => { order.push("emit"); });
    const runFmImpl = vi.fn(async () => { order.push(`fm@${sb.events.length}`); return fmResult(); });
    const logger = quiet();
    const out = await createWorker({ serviceSb: sb, now: () => T0, logger, emit, checkRowsImpl: check, runFmImpl, memoryUsage: () => ({ rss: 50 * 1024 * 1024 }) }).tick();
    expect(order.map((o) => o.split("@")[0])).toEqual(["711", "emit", "fm", "emit"]);
    const at = Number(order[2].split("@")[1]);
    const before = sb.events.slice(0, at), after = sb.events.slice(at);
    for (const done of ["parcel_tracking_jobs.update", "parcel_tracking_health.insert", "parcel_tracking_access.update", "parcel_tracking.delete"]) expect(before).toContain(done);
    expect(after).toEqual(["parcel_tracking_jobs.update"]);   // ONE small update: the counts
    // the first write of the job row is the 7-11 result alone
    const [first, patch] = jobUpdates(sb);
    expect(first).toMatchObject({ status: "done", error: null, parcels_total: 2, parcels_checked: 2, requests_used: 3 });
    expect(first.finished_at).toBeTruthy();
    expect(patch).toEqual({ parcels_total: 5, parcels_checked: 5 });   // nothing else of the row is touched
    expect(healthRows(sb)[0]).toMatchObject({ kind: "manual", updated: 2, requests: 3 });
    expect(emit.mock.calls.map((c) => (c as unknown as [string, Row])[1])).toEqual([
      expect.objectContaining({ checked: 2, total: 2 }), expect.objectContaining({ checked: 5, total: 5 }),
    ]);
    expect(out).toMatchObject({ status: "done", checked: 5, total: 5 });
    expect(logger.log.mock.calls.some((c) => /done job=J1 .*checked=2\/2 /.test(String(c[0])))).toBe(true);
    expect(logger.log.mock.calls.some((c) => /FamilyMart job=J1 user=U1 kind=manual checked=3\/3/.test(String(c[0])))).toBe(true);
  });

  it("the 全家 part failing changes nothing of the 7-11 result (only the total the seller sees grows)", async () => {
    const cfg = { job: job("manual"), rows: [row711("a"), row711("b")] };
    const off = await runOne(cfg);
    const failed = await runOne(cfg, { runFmImpl: async () => fmResult({ checked: 0, failed: true, reason: "circuit_open" }) });
    expect(strip(jobUpdates(failed.sb)[0])).toEqual(strip(jobUpdates(off.sb)[0]));
    expect(jobUpdates(failed.sb)[1]).toEqual({ parcels_total: 5, parcels_checked: 2 });
    expect(healthRows(failed.sb).map(strip)).toEqual(healthRows(off.sb).map(strip));
    expect(accessUpdates(failed.sb)).toEqual(accessUpdates(off.sb));
    expect(failed.sb.rpcs.some((r) => r.name === "parcel_tracking_refund_press")).toBe(false); // the 7-11 parcels were checked → the press was used
  });

  it("a 7-11 failure (breaker) does not stop the 全家 part", async () => {
    const check = vi.fn(async () => ({ batchesRun: 3, updated: 0, unknowns: 0, notFound: 0, captchaFails: 3, failures: 3, retired: 0, tripped: true, stopReason: "circuit_open", sent: 9 }));
    const runFmImpl = vi.fn(async () => fmResult());
    const { sb } = await runOne({ job: job("manual"), rows: [row711("a")] }, { checkRowsImpl: check, runFmImpl });
    expect(runFmImpl).toHaveBeenCalledTimes(1);
    expect(jobUpdates(sb)[0]).toMatchObject({ status: "failed", error: "circuit_open", parcels_checked: 0 });
    expect(jobUpdates(sb)[1]).toEqual({ parcels_total: 4, parcels_checked: 3 });
    expect(accessUpdates(sb)).toEqual([]); // 7-11 had parcels and checked none → "last checked" is not stamped by 全家
  });

  it("a seller with ONLY 全家 parcels: the 7-11 part ends as before (press given back), then 全家 checks → last checked stamped, the press counts again", async () => {
    const pressed = iso(60_000);
    const { sb, check, emit } = await runOne({ job: job("manual", { requested_at: pressed }), rows: [] }, { runFmImpl: async () => fmResult() });
    expect(check).not.toHaveBeenCalled();
    expect(jobUpdates(sb)[0]).toMatchObject({ status: "done", error: null, parcels_total: 0, parcels_checked: 0, requests_used: 0 });
    expect(sb.rpcs.filter((r) => r.name === "parcel_tracking_refund_press").length).toBe(1);     // exactly what main does for "nothing to check"
    expect(jobUpdates(sb)[1]).toEqual({ parcels_total: 3, parcels_checked: 3 });
    expect(accessUpdates(sb)).toEqual([{ last_completed_at: T0.toISOString(), last_manual_check_at: pressed, last_manual_check_day: "2026-11-12" }]);
    expect(trail(sb).indexOf("rpc.parcel_tracking_refund_press")).toBeLessThan(trail(sb).lastIndexOf("parcel_tracking_access.update"));
    expect(emit).toHaveBeenLastCalledWith("U1", expect.objectContaining({ checked: 3, total: 3 }));
  });

  it("only 全家 parcels and the 全家 part answered none → the press stays given back, nothing is stamped", async () => {
    const { sb } = await runOne({ job: job("manual"), rows: [] }, { runFmImpl: async () => fmResult({ checked: 0, failed: true, reason: "circuit_open" }) });
    expect(sb.rpcs.filter((r) => r.name === "parcel_tracking_refund_press")).toEqual([{ name: "parcel_tracking_refund_press", args: { p_job_id: "J1" } }]);
    expect(jobUpdates(sb)[1]).toEqual({ parcels_total: 3, parcels_checked: 0 });
    expect(accessUpdates(sb)).toEqual([]);
  });

  it("an automatic job with only 全家 parcels stamps last checked, and never touches the press", async () => {
    const { sb } = await runOne({ job: job("auto"), rows: [], settings: { parcel_tracking_auto_mode: "all" } }, { runFmImpl: async () => fmResult() });
    expect(accessUpdates(sb)).toEqual([{ last_completed_at: T0.toISOString() }]);
  });

  it("the daily health job never runs the 全家 part", async () => {
    const runFmImpl = vi.fn(async () => fmResult());
    await runOne({ job: job("health", { created_by: "worker" }), rows: [row711("a")] }, { runFmImpl });
    expect(runFmImpl).not.toHaveBeenCalled();
  });

  it("is handed this job, a picking rule and the job's hard stop", async () => {
    const runFmImpl = vi.fn(async (_a: Row) => fmResult());
    await runOne({ job: job("manual"), rows: [row711("a")] }, { runFmImpl });
    const a = runFmImpl.mock.calls[0][0] as Row;
    expect((a.job as Row).id).toBe("J1");
    expect(a.deadlineAt).toBe(T0.getTime() + JOB_MAX_MS);
    expect(typeof a.scopeOf).toBe("function");
  });
});

describe("which 全家 parcels a job picks (same rules as 7-11, its own cap)", () => {
  const scopeFor = async (kind: string, extra: Row = {}, settings: Record<string, string> = {}) => {
    let scopeOf: ((rows: Row[]) => { rows: Row[]; capped: boolean }) | null = null;
    await runOne({ job: job(kind, extra), rows: [], settings }, { runFmImpl: async (a: Row) => { scopeOf = a.scopeOf as typeof scopeOf; return fmResult({ total: 0, checked: 0, ran: false }); } });
    return scopeOf!;
  };
  it("Check now: everything except in-transit parcels checked less than 24 hours ago; at most 60", async () => {
    const scopeOf = await scopeFor("manual");
    const picked = scopeOf([rowFm(1), rowFm(2, { status: "in_transit", last_polled_at: iso(2 * H) }), rowFm(3, { status: "in_transit", last_polled_at: iso(30 * H) })]);
    expect(picked.rows.map((r) => r.id)).toEqual(["fm1", "fm3"]);
    const many = scopeOf(Array.from({ length: 100 }, (_, i) => rowFm(i)));
    expect([many.rows.length, many.capped]).toEqual([FM_PARCELS_PER_JOB, true]);
  });
  it("after a Sync: only the new, never-checked parcels of that upload", async () => {
    const scopeOf = await scopeFor("new_parcels");
    const picked = scopeOf([rowFm(1, { last_polled_at: null, created_at: iso(30_000) }), rowFm(2, { last_polled_at: null, created_at: iso(48 * H) }), rowFm(3, { created_at: iso(30_000) })]);
    expect(picked.rows.map((r) => r.id)).toEqual(["fm1"]);
  });
  it("urgent: at-store parcels due today or tomorrow", async () => {
    const scopeOf = await scopeFor("urgent");
    const picked = scopeOf([rowFm(1, { pickup_deadline: "2026-11-13" }), rowFm(2, { pickup_deadline: "2026-11-20" }), rowFm(3, { status: "in_transit", pickup_deadline: "2026-11-12" })]);
    expect(picked.rows.map((r) => r.id)).toEqual(["fm1"]);
  });
  it("automatic check: the automatic rules (due soon first, then never checked, then stale)", async () => {
    const scopeOf = await scopeFor("auto", {}, { parcel_tracking_auto_mode: "all" });
    const picked = scopeOf([
      rowFm(1, { status: "in_transit", last_polled_at: iso(2 * H) }),          // checked 2h ago → not yet
      rowFm(2, { status: "in_transit", last_polled_at: iso(20 * H) }),         // stale
      rowFm(3, { last_polled_at: null, status: "in_transit" }),                // never checked
      rowFm(4, { pickup_deadline: "2026-11-13", last_polled_at: iso(1 * H) }), // at store, due soon
    ]);
    expect(picked.rows.map((r) => r.id)).toEqual(["fm4", "fm3", "fm2"]);
  });
});

describe("fmStampsLastChecked / fmKeepsPress", () => {
  const ok = { ran: true, total: 3, checked: 3, failed: false };
  it("last checked: checked > 0 by 7-11 (its own stamp), or 7-11 had nothing AND 全家 answered", () => {
    expect(fmStampsLastChecked(job("manual"), 0, ok)).toBe(true);
    expect(fmStampsLastChecked(job("auto"), 0, ok)).toBe(true);
    expect(fmStampsLastChecked(job("manual"), 2, ok)).toBe(false);                       // 7-11 had parcels → its own rule decides
    expect(fmStampsLastChecked(job("manual"), 0, { ...ok, checked: 0 })).toBe(false);
    expect(fmStampsLastChecked(job("urgent"), 0, ok)).toBe(false);
    expect(fmStampsLastChecked(job("new_parcels"), 0, ok)).toBe(false);
  });
  it("the press counts again only for a seller's Check now that the 7-11 part gave back and 全家 then answered", () => {
    expect(fmKeepsPress(job("manual"), "done", 0, ok)).toBe(true);
    expect(fmKeepsPress(job("manual"), "done", 2, ok)).toBe(false);
    expect(fmKeepsPress(job("manual"), "done", 0, { ...ok, checked: 0, failed: true })).toBe(false);
    expect(fmKeepsPress(job("manual"), "failed", 0, ok)).toBe(false);
    expect(fmKeepsPress(job("manual", { created_by: "admin" }), "done", 0, ok)).toBe(false);
    expect(fmKeepsPress(job("auto"), "done", 0, ok)).toBe(false);
  });
});
