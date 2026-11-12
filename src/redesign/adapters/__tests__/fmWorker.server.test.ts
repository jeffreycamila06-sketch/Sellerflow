// The FamilyMart (全家) part inside the job worker (server/parcelTrackingWorker.js).
//   • 全家 will NOT run (switch off, not allowed, nothing due, an earlier one still running): the job
//     is finished by the code of before — the only extra work is one small settings read.
//   • 全家 runs: the 7-11 numbers (health row, duration) are taken first, the job row stays 'running'
//     while the 全家 parcels are checked, then ONE final job row, ONE press decision, ONE message.
// (The unchanged 7-11 suite, parcelTrackingWorker.server.test.ts, runs with the 全家 switch off.)
import { describe, it, expect, vi } from "vitest";
import { createWorker, fmStampsLastChecked, fmRefundsPress, JOB_MAX_MS, FM_PART_MAX_MS } from "../../../../server/parcelTrackingWorker.js";
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
// "the 全家 part will run, with 3 parcels" — what planFmForJob answers when the switch is on.
const planOn = (n = 3) => async () => ({ run: true, reason: null, rows: Array.from({ length: n }, (_, i) => rowFm(i + 1)), capped: false, image: null, failStreak: 0 });
const planOff = async () => ({ run: false, reason: "disabled", rows: [], capped: false });
const fmOn = (over: Row = {}, n = 3) => ({ planFmImpl: planOn(n), runFmImpl: async () => fmResult(over) });

const jobUpdates = (sb: ReturnType<typeof fakeSb>) => sb.queries.filter((q) => q.table === "parcel_tracking_jobs" && q.op === "update").map((q) => q.patch as Row);
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

const isFmGateRead = (q: Q) => q.table === "app_settings" && ((q.filters.find((f) => f[0] === "in")?.[2] ?? []) as string[]).includes("fm_check_enabled");
const refunds = (sb: ReturnType<typeof fakeSb>) => sb.rpcs.filter((r) => r.name === "parcel_tracking_refund_press");

describe("全家 will not run — the job is what it was", () => {
  it("no fm_check_enabled row: ONE small settings read, no 全家 row read, no 全家 request; everything else in the same order", async () => {
    const cfg = { job: job("manual"), rows: [row711("a"), row711("b")] };
    const real = await runOne(cfg);                                  // the real plan step, switch row missing
    const none = await runOne(cfg, { planFmImpl: planOff });         // no 全家 read at all
    expect(real.sb.queries.filter(isFmGateRead).length).toBe(1);
    expect(real.sb.queries.some((q) => q.table === "parcel_tracking" && q.filters.some((f) => f[0] === "eq" && f[1] === "carrier" && f[2] === "fm"))).toBe(false);
    expect(real.sb.queries.some((q) => q.table === "fm_tracking_daily")).toBe(false);
    expect(real.sb.rpcs.some((r) => r.name === "fm_check_open_for")).toBe(false);
    // exactly ONE database call more than a job with no 全家 code at all, and the rest in the same order
    const events = trail(real.sb);
    const gateAt = real.sb.queries.findIndex(isFmGateRead);           // queries and events line up until the first rpc…
    expect(events.length).toBe(trail(none.sb).length + 1);
    const without = real.sb.queries.filter((q) => !isFmGateRead(q)).map((q) => `${q.table}.${q.op}`);
    expect(without).toEqual(none.sb.queries.map((q) => `${q.table}.${q.op}`));
    expect(real.sb.rpcs).toEqual(none.sb.rpcs);
    // …and it comes after the 7-11 check, before the job is finished
    expect(real.sb.queries.slice(0, gateAt).some((q) => q.table === "parcel_tracking_jobs" && q.op === "update")).toBe(false);
    expect(real.sb.queries[gateAt + 1]).toMatchObject({ table: "parcel_tracking_jobs", op: "update" });
    expect(jobUpdates(real.sb).length).toBe(1);
    expect(real.emit).toHaveBeenCalledTimes(1);
    expect(real.check).toHaveBeenCalledTimes(1);
  });

  it("everything the job writes is IDENTICAL with the plan step off, saying no, crashing, or never answering", async () => {
    const cfg = { job: job("manual"), rows: [row711("a"), row711("b")] };
    const off = await runOne(cfg, { planFmImpl: planOff });
    const real = await runOne(cfg);
    const idle = await runOne(cfg, { planFmImpl: async () => ({ run: false, reason: "nothing_due", rows: [], capped: false }) });
    const crash = await runOne(cfg, { planFmImpl: async () => { throw new Error("boom"); } });
    const hung = await runOne(cfg, { planFmImpl: () => new Promise(() => {}), fmPlanMaxMs: 20 });
    const runFmImpl = vi.fn(async () => fmResult());
    const empty = await runOne(cfg, { planFmImpl: async () => ({ run: true, rows: [], capped: false }), runFmImpl });
    const seven = (sb: ReturnType<typeof fakeSb>) => sb.queries.filter((q) => !isFmGateRead(q)).map((q) => `${q.table}.${q.op}`);
    for (const other of [real, idle, crash, hung, empty]) {
      expect(jobUpdates(other.sb).map(strip)).toEqual(jobUpdates(off.sb).map(strip));
      expect(healthRows(other.sb).map(strip)).toEqual(healthRows(off.sb).map(strip));
      expect(accessUpdates(other.sb)).toEqual(accessUpdates(off.sb));
      expect(other.sb.rpcs).toEqual(off.sb.rpcs);
      const pick = (c: ReturnType<typeof checkOk>) => { const a = c.mock.calls[0][0] as Row; return { rows: a.rows, requestBudget: a.requestBudget, deadlineAt: a.deadlineAt, limits: a.limits, tag: a.tag }; };
      expect(pick(other.check)).toEqual(pick(off.check));
      expect(other.emit.mock.calls).toEqual(off.emit.mock.calls);
      expect(seven(other.sb)).toEqual(seven(off.sb));
      expect(other.out).toEqual(off.out);
      expect(other.logger.log.mock.calls.map((c) => String(c[0]))).toEqual(off.logger.log.mock.calls.map((c) => String(c[0])));
    }
    expect(jobUpdates(off.sb)[0]).toMatchObject({ status: "done", error: null, parcels_total: 2, parcels_checked: 2, requests_used: 3 });
    expect(runFmImpl).not.toHaveBeenCalled();                         // a plan with no parcel is "will not run"
    expect(crash.logger.error.mock.calls.some((c) => String(c[0]).includes("FamilyMart plan threw"))).toBe(true);
  });

  it("the 全家 part can hold the worker for at most its own time limit + 2 minutes", () => {
    expect(FM_PART_MAX_MS).toBe(FM_JOB_MAX_MS + 2 * 60 * 1000);
  });
});

describe("全家 runs — ONE result", () => {
  it("7-11 health row first; the job row stays 'running' until the 全家 part is over; then ONE job row (7-11 + 全家) and ONE message", async () => {
    const order: string[] = [];
    const sb = fakeSb({ job: job("manual"), rows: [row711("a"), row711("b")] });
    const check = vi.fn(async (a: { rows: unknown[] }) => { order.push("711"); return { batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0, tripped: false, stopReason: null, sent: 3 }; });
    const emit = vi.fn(() => { order.push("emit"); });
    const runFmImpl = vi.fn(async () => { order.push(`fm@${sb.events.length}`); return fmResult(); });
    const logger = quiet();
    const out = await createWorker({ serviceSb: sb, now: () => T0, logger, emit, checkRowsImpl: check, planFmImpl: planOn(), runFmImpl, memoryUsage: () => ({ rss: 50 * 1024 * 1024 }) }).tick();
    expect(order.map((o) => o.split("@")[0])).toEqual(["711", "fm", "emit"]);
    const at = Number(order[1].split("@")[1]);
    const before = sb.events.slice(0, at), after = sb.events.slice(at);
    expect(before).toContain("parcel_tracking_health.insert");        // the 7-11 numbers are taken before 全家
    expect(before).not.toContain("parcel_tracking_jobs.update");      // …and the job row is still 'running'
    expect(before).not.toContain("parcel_tracking_access.update");
    expect(after).toEqual(["parcel_tracking_jobs.update", "parcel_tracking_access.update", "parcel_tracking.delete", "parcel_tracking.select"]); // + purge and follow-up, as before
    expect(jobUpdates(sb)).toEqual([{ status: "done", error: null, finished_at: T0.toISOString(), parcels_total: 5, parcels_checked: 5, requests_used: 3 }]);
    expect(healthRows(sb)).toEqual([expect.objectContaining({ kind: "manual", updated: 2, requests: 3, ok: true })]);
    expect(accessUpdates(sb)).toEqual([{ last_completed_at: T0.toISOString() }]);
    expect(refunds(sb)).toEqual([]);
    expect(emit.mock.calls.map((c) => (c as unknown as [string, Row])[1])).toEqual([expect.objectContaining({ checked: 5, total: 5 })]);
    expect(out).toMatchObject({ status: "done", error: null, checked: 5, total: 5 });
    expect(logger.log.mock.calls.filter((c) => /done job=J1 /.test(String(c[0]))).map((c) => String(c[0]))).toEqual([expect.stringMatching(/status=done checked=5\/5 requests=3 .*familymart=3\/3 /)]);
  });

  it("the 全家 part answering nothing does not change the 7-11 result — and the press is kept (7-11 answered)", async () => {
    const cfg = { job: job("manual"), rows: [row711("a"), row711("b")] };
    const off = await runOne(cfg, { planFmImpl: planOff });
    const failed = await runOne(cfg, fmOn({ checked: 0, failed: true, reason: "circuit_open" }));
    expect(jobUpdates(failed.sb)).toEqual([{ ...jobUpdates(off.sb)[0], parcels_total: 5, parcels_checked: 2 }]);
    expect(healthRows(failed.sb).map(strip)).toEqual(healthRows(off.sb).map(strip));
    expect(accessUpdates(failed.sb)).toEqual(accessUpdates(off.sb));
    expect(refunds(failed.sb)).toEqual([]);
  });

  it("a 7-11 failure (breaker) does not stop the 全家 part; the job keeps the 7-11 status", async () => {
    const check = vi.fn(async () => ({ batchesRun: 3, updated: 0, unknowns: 0, notFound: 0, captchaFails: 3, failures: 3, retired: 0, tripped: true, stopReason: "circuit_open", sent: 9 }));
    const runFmImpl = vi.fn(async () => fmResult());
    const { sb } = await runOne({ job: job("manual"), rows: [row711("a")] }, { checkRowsImpl: check, planFmImpl: planOn(), runFmImpl });
    expect(runFmImpl).toHaveBeenCalledTimes(1);
    expect(jobUpdates(sb)).toEqual([expect.objectContaining({ status: "failed", error: "circuit_open", parcels_total: 4, parcels_checked: 3 })]);
    expect(refunds(sb)).toEqual([]);          // 全家 answered → the press was used
    expect(accessUpdates(sb)).toEqual([]);    // 7-11 had parcels and checked none → "last checked" is not stamped
  });

  it("the press: the 7-11 rule of before decides — and it is never given back when 全家 answered; decided once, at the end", async () => {
    const none = () => vi.fn(async () => ({ batchesRun: 1, updated: 0, unknowns: 0, notFound: 0, captchaFails: 1, failures: 1, retired: 0, tripped: false, stopReason: "time_limit", sent: 4 }));
    // only 全家 parcels, all answered → kept (no give-back-then-count-again)
    const a = await runOne({ job: job("manual"), rows: [] }, fmOn());
    expect(a.check).not.toHaveBeenCalled();
    expect(refunds(a.sb)).toEqual([]);
    expect(jobUpdates(a.sb)).toEqual([{ status: "done", error: null, finished_at: T0.toISOString(), parcels_total: 3, parcels_checked: 3, requests_used: 0 }]);
    expect(accessUpdates(a.sb)).toEqual([{ last_completed_at: T0.toISOString() }]);   // never last_manual_check_*
    expect(a.emit.mock.calls.length).toBe(1);
    // only 全家 parcels, none answered → given back, nothing stamped
    const b = await runOne({ job: job("manual"), rows: [] }, fmOn({ checked: 0, failed: true, reason: "circuit_open" }));
    expect(refunds(b.sb)).toEqual([{ name: "parcel_tracking_refund_press", args: { p_job_id: "J1" } }]);
    expect(jobUpdates(b.sb)).toEqual([expect.objectContaining({ status: "done", parcels_total: 3, parcels_checked: 0 })]);
    expect(accessUpdates(b.sb)).toEqual([]);
    expect(trail(b.sb).indexOf("rpc.parcel_tracking_refund_press")).toBeGreaterThan(trail(b.sb).indexOf("parcel_tracking_jobs.update"));
    // 7-11 had a parcel, ended 'done' with 0 answered (time limit): main keeps the press → kept here too, whatever 全家 did
    const c = await runOne({ job: job("manual"), rows: [row711("a")] }, { ...fmOn({ checked: 0, failed: true }), checkRowsImpl: none() });
    expect(jobUpdates(c.sb)[0]).toMatchObject({ status: "done", error: "partial", parcels_checked: 0 });
    expect(refunds(c.sb)).toEqual([]);
    const d = await runOne({ job: job("manual"), rows: [row711("a")] }, { ...fmOn(), checkRowsImpl: none() });
    expect(refunds(d.sb)).toEqual([]);
    // 7-11 FAILED (breaker): main gives the press back → given back when 全家 answered nothing, kept when it answered
    const tripped = () => vi.fn(async () => ({ batchesRun: 3, updated: 0, unknowns: 0, notFound: 0, captchaFails: 3, failures: 3, retired: 0, tripped: true, stopReason: "circuit_open", sent: 9 }));
    const f = await runOne({ job: job("manual"), rows: [row711("a")] }, { ...fmOn({ checked: 0, failed: true }), checkRowsImpl: tripped() });
    expect(refunds(f.sb).length).toBe(1);
    const g = await runOne({ job: job("manual"), rows: [row711("a")] }, { ...fmOn(), checkRowsImpl: tripped() });
    expect(refunds(g.sb)).toEqual([]);
    // for every case above with 全家 answering nothing, the decision is the one a job WITHOUT 全家 makes
    for (const [rows, check] of [[[], none()], [[row711("a")], none()], [[row711("a")], tripped()]] as [Row[], ReturnType<typeof none>][]) {
      const plain = await runOne({ job: job("manual"), rows }, { planFmImpl: planOff, checkRowsImpl: check });
      const withFm = await runOne({ job: job("manual"), rows }, { ...fmOn({ checked: 0, failed: true }), checkRowsImpl: check });
      expect(refunds(withFm.sb)).toEqual(refunds(plain.sb));
    }
    // an admin's / an automatic job never used a press
    const e = await runOne({ job: job("manual", { created_by: "admin" }), rows: [] }, fmOn({ checked: 0, failed: true }));
    expect(refunds(e.sb)).toEqual([]);
  });

  it("an automatic job with only 全家 parcels stamps last checked, and never touches the press", async () => {
    const { sb } = await runOne({ job: job("auto"), rows: [], settings: { parcel_tracking_auto_mode: "all" } }, fmOn());
    expect(accessUpdates(sb)).toEqual([{ last_completed_at: T0.toISOString() }]);
    expect(refunds(sb)).toEqual([]);
  });

  it("the daily health job never asks about 全家", async () => {
    const planFmImpl = vi.fn(planOn());
    const { sb } = await runOne({ job: job("health", { created_by: "worker" }), rows: [row711("a")] }, { planFmImpl, runFmImpl: async () => fmResult() });
    expect(planFmImpl).not.toHaveBeenCalled();
    expect(sb.queries.some(isFmGateRead)).toBe(false);
  });

  it("is handed this job, the plan, the job's hard stop, its own hard stop and a stop flag", async () => {
    const runFmImpl = vi.fn(async (_a: Row) => fmResult());
    await runOne({ job: job("manual"), rows: [row711("a")] }, { planFmImpl: planOn(), runFmImpl });
    const a = runFmImpl.mock.calls[0][0] as Row;
    expect((a.job as Row).id).toBe("J1");
    expect(((a.plan as Row).rows as Row[]).length).toBe(3);
    expect(a.deadlineAt).toBe(T0.getTime() + JOB_MAX_MS);
    expect(a.hardStopAt).toBe(T0.getTime() + FM_PART_MAX_MS);
    expect(a.control).toEqual({ cancelled: false, checked: 0 });
  });

  it("a 全家 part that throws: the job is still finished once, with the 7-11 result", async () => {
    const { sb, out, logger } = await runOne({ job: job("manual"), rows: [row711("a"), row711("b")] }, { planFmImpl: planOn(), runFmImpl: async () => { throw new Error("boom"); } });
    expect(jobUpdates(sb)).toEqual([expect.objectContaining({ status: "done", error: null, parcels_total: 5, parcels_checked: 2 })]);
    expect(out).toMatchObject({ status: "done", checked: 2, total: 5 });
    expect(logger.error.mock.calls.some((c) => String(c[0]).includes("FamilyMart part threw"))).toBe(true);
  });
});

describe("the 全家 part's time limit", () => {
  // a clock that really moves (ms since the test started, on top of T0)
  const clock = () => { const t = Date.now(); return () => new Date(T0.getTime() + (Date.now() - t)); };

  it("at the limit: the left-behind work is told to stop, the job is finished with what was written so far, and the 全家 time counts for the worker's rest", async () => {
    let seen: { cancelled: boolean; checked: number } | null = null;
    const runFmImpl = (a: Row) => { seen = a.control as typeof seen; seen!.checked = 1; return new Promise(() => {}); };   // one row written, then it hangs
    const sb = fakeSb({ job: job("manual"), rows: [row711("a"), row711("b")] });
    const logger = quiet(), emit = vi.fn();
    const out = await createWorker({ serviceSb: sb, now: clock(), logger, emit, checkRowsImpl: checkOk(), planFmImpl: planOn(), runFmImpl, fmPartMaxMs: 40, memoryUsage: () => ({ rss: 50 * 1024 * 1024 }) }).tick() as Row;
    expect(seen!.cancelled).toBe(true);
    expect(jobUpdates(sb)).toEqual([expect.objectContaining({ status: "done", error: null, parcels_total: 5, parcels_checked: 3 })]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(out.durationMs as number).toBeGreaterThanOrEqual(35);      // the 40 ms the 全家 part held the worker are in it
    expect((healthRows(sb)[0].duration_ms as number)).toBeLessThan(35); // the 7-11 health row carries the 7-11 time only
    expect(logger.error.mock.calls.some((c) => String(c[0]).includes("told to stop"))).toBe(true);
  });

  it("only ONE 全家 part at a time: while a left-behind one has not come back, the next job skips 全家 (and is finished as before)", async () => {
    let release: (v: unknown) => void = () => {};
    const planFmImpl = vi.fn(planOn());
    const runFmImpl = vi.fn(() => new Promise((r) => { release = r; }));
    const sb = fakeSb({ job: job("manual"), rows: [row711("a")] });
    const logger = quiet();
    const w = createWorker({ serviceSb: sb, now: () => T0, logger, emit: vi.fn(), checkRowsImpl: checkOk(), planFmImpl, runFmImpl, fmPartMaxMs: 20, memoryUsage: () => ({ rss: 50 * 1024 * 1024 }) });
    await w.tick();                                                   // job 1: 全家 hangs → left behind
    expect([planFmImpl.mock.calls.length, runFmImpl.mock.calls.length]).toEqual([1, 1]);
    const second = await w.tick() as Row;                             // job 2
    expect([planFmImpl.mock.calls.length, runFmImpl.mock.calls.length]).toEqual([1, 1]);   // not even asked
    expect(second).toMatchObject({ status: "done", checked: 1, total: 1 });
    expect(logger.warn.mock.calls.some((c) => String(c[0]).includes("an earlier one is still running"))).toBe(true);
    release(fmResult());                                              // the left-behind one comes back
    await new Promise((r) => setTimeout(r, 5));
    await w.tick();                                                   // job 3
    expect([planFmImpl.mock.calls.length, runFmImpl.mock.calls.length]).toEqual([2, 2]);
  });
});

describe("which 全家 parcels a job picks (same rules as 7-11, its own cap)", () => {
  const scopeFor = async (kind: string, extra: Row = {}, settings: Record<string, string> = {}) => {
    let scopeOf: ((rows: Row[]) => { rows: Row[]; capped: boolean }) | null = null;
    await runOne({ job: job(kind, extra), rows: [], settings }, { planFmImpl: async (a: Row) => { scopeOf = a.scopeOf as typeof scopeOf; return { run: false, reason: "nothing_due", rows: [], capped: false }; } });
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

describe("fmStampsLastChecked / fmRefundsPress", () => {
  const ok = { total: 3, checked: 3 };
  it("last checked: 7-11 checked a parcel (as before), or 7-11 had nothing AND 全家 answered", () => {
    expect(fmStampsLastChecked(job("manual"), 0, 0, ok)).toBe(true);
    expect(fmStampsLastChecked(job("auto"), 0, 0, ok)).toBe(true);
    expect(fmStampsLastChecked(job("manual"), 2, 2, { ...ok, checked: 0 })).toBe(true);     // the 7-11 rule
    expect(fmStampsLastChecked(job("manual"), 0, 2, ok)).toBe(false);                       // 7-11 had parcels and checked none
    expect(fmStampsLastChecked(job("manual"), 0, 0, { ...ok, checked: 0 })).toBe(false);
    expect(fmStampsLastChecked(job("urgent"), 2, 2, ok)).toBe(false);
    expect(fmStampsLastChecked(job("new_parcels"), 0, 0, ok)).toBe(false);
  });
  it("the press: shouldRefundPress on the 7-11 status and total, and never when 全家 answered", () => {
    const none = { ...ok, checked: 0 };
    expect(fmRefundsPress(job("manual"), "done", 0, none)).toBe(true);        // nothing to check for 7-11, nothing answered by 全家
    expect(fmRefundsPress(job("manual"), "failed", 2, none)).toBe(true);      // 7-11 failed
    expect(fmRefundsPress(job("manual"), "done", 2, none)).toBe(false);       // 7-11 had parcels and ended 'done' → main keeps the press
    expect(fmRefundsPress(job("manual"), "skipped", 2, none)).toBe(false);    // 7-11 over its daily cap → main keeps the press
    expect(fmRefundsPress(job("manual"), "done", 0, ok)).toBe(false);         // 全家 answered → never given back
    expect(fmRefundsPress(job("manual"), "failed", 2, ok)).toBe(false);
    expect(fmRefundsPress(job("manual", { created_by: "admin" }), "done", 0, none)).toBe(false);
    expect(fmRefundsPress(job("auto"), "failed", 0, none)).toBe(false);
    expect(fmRefundsPress(job("urgent"), "done", 0, none)).toBe(false);
  });
});
