// server/parcelTrackingWorker.js — Stage 2 on-demand job worker. Pure helpers (plan
// caps, job scope, outcome) + the tick lifecycle with a fake service-role client and
// an injected checkRows (the batch loop itself is covered by the runPoll suite).
import { describe, it, expect, vi } from "vitest";
import {
  planCaps, scopeForJob, jobOutcome, taipeiHour, createWorker, shouldRefundPress, JOB_MAX_MS, REST_MS,
} from "../../../../server/parcelTrackingWorker.js";

const T0 = new Date("2026-09-29T02:00:00Z"); // 10:00 Taipei
const iso = (ms: number) => new Date(T0.getTime() - ms).toISOString();
const H = 60 * 60 * 1000;

type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
type Cfg = {
  enabled?: string; plan?: string; role?: string; job?: Record<string, unknown> | null; claimError?: unknown;
  rows?: Record<string, unknown>[]; todaysJobs?: { requests_used: number }[]; dailyRequests?: number;
  healthToday?: boolean; freshAfter?: boolean;
};
function fakeSb(cfg: Cfg = {}) {
  const queries: Q[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const resolve = (q: Q) => {
    const has = (k: string, ...v: unknown[]) => q.filters.some((f) => f[0] === k && v.every((x, i) => f[i + 1] === x));
    if (q.table === "app_settings") return { data: [{ key: "parcel_tracking_enabled", value: cfg.enabled ?? "true" }], error: null };
    if (q.table === "seller_profiles") return { data: { plan: cfg.plan ?? "plus", role: cfg.role ?? "seller" }, error: null };
    if (q.table === "parcel_tracking_daily") return { data: { requests: cfg.dailyRequests ?? 0 }, error: null };
    if (q.table === "parcel_tracking_jobs" && q.op === "select") {
      if (has("eq", "kind", "health")) return { data: cfg.healthToday ? [{ id: "h" }] : [], error: null };
      return { data: cfg.todaysJobs ?? [], error: null };
    }
    if (q.table === "parcel_tracking" && q.op === "select") {
      if (q.filters.some((f) => f[0] === "is")) return { data: cfg.freshAfter ? [{ id: "x" }] : [], error: null };
      const r = q.filters.find((f) => f[0] === "range") as [string, number, number];
      return { data: (cfg.rows ?? []).slice(r[1], r[2] + 1), error: null };
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
          if (["update", "insert", "delete", "upsert"].includes(k)) { q.op = k; q.patch = args[0]; }
          else if (k !== "select" && k !== "maybeSingle") q.filters.push([k, ...args]);
          return ch;
        };
      },
    });
    return ch;
  };
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    rpcs.push({ name, args });
    if (name === "parcel_tracking_claim_job") return Promise.resolve({ data: cfg.job ? [cfg.job] : [], error: cfg.claimError ?? null });
    return Promise.resolve({ data: "new-id", error: null });
  };
  return { from, rpc, queries, rpcs };
}
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const job = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ id: "J1", user_id: "U1", kind, status: "running", created_by: kind === "manual" ? "seller" : "sync", requested_at: iso(60_000), started_at: iso(0), ...extra });
const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "U1", tracking_no: `F${id}0000000`, status: "in_transit", last_polled_at: null, created_at: iso(2 * H), ...extra });
const checkOk = (over: Record<string, unknown> = {}) => vi.fn(async (a: { rows: unknown[] }) => ({
  batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0,
  tripped: false, stopReason: null, sent: 3, ...over,
}));
const jobUpdate = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_jobs" && q.op === "update");
const accessUpdate = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_access" && q.op === "update");
const health = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_health");

describe("planCaps", () => {
  it("Plus (and unknown) = 300 parcels / 300 requests; Pro / Master / admin = 600 / 600", () => {
    expect(planCaps("plus")).toEqual({ parcels: 300, requests: 300 });
    expect(planCaps("")).toEqual({ parcels: 300, requests: 300 });
    expect(planCaps("Pro")).toEqual({ parcels: 600, requests: 600 });
    expect(planCaps("master")).toEqual({ parcels: 600, requests: 600 });
    expect(planCaps("basic", true)).toEqual({ parcels: 600, requests: 600 });
  });
});

describe("scopeForJob", () => {
  const caps = { parcels: 300, requests: 300 };
  it("manual: skips in-transit rows checked < 24h ago, keeps older in-transit and every other status", () => {
    const rows = [
      row("a", { last_polled_at: iso(30 * H) }),
      row("b", { last_polled_at: iso(2 * H) }),                       // fresh in_transit → skipped
      row("c", { status: "at_store", last_polled_at: iso(1 * H) }),   // at_store always kept
      row("d"),                                                        // never checked
    ];
    expect(scopeForJob(job("manual"), rows, T0, caps).rows.map((r) => r.id)).toEqual(["a", "c", "d"]);
  });
  it("manual: caps to the plan limit in the given (stalest-first) order and flags capped", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`r${i}`));
    const s = scopeForJob(job("manual"), rows, T0, { parcels: 3, requests: 3 });
    expect(s.rows.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(s.capped).toBe(true);
    expect(scopeForJob(job("manual"), rows.slice(0, 3), T0, { parcels: 3, requests: 3 }).capped).toBe(false);
  });
  it("new_parcels: never-checked rows created since 5 min before the request only", () => {
    const j = job("new_parcels", { requested_at: iso(10 * 60_000) });
    const rows = [
      row("new", { created_at: iso(12 * 60_000) }),            // within the 5-min slack
      row("old", { created_at: iso(20 * 60_000) }),            // before it
      row("seen", { created_at: iso(1 * 60_000), last_polled_at: iso(0) }),
    ];
    expect(scopeForJob(j, rows, T0, caps).rows.map((r) => r.id)).toEqual(["new"]);
  });
  it("new_parcels caps at 300 even for a 600 plan", () => {
    const rows = Array.from({ length: 350 }, (_, i) => row(`n${i}`, { created_at: iso(0) }));
    expect(scopeForJob(job("new_parcels", { requested_at: iso(0) }), rows, T0, { parcels: 600, requests: 600 }).rows).toHaveLength(300);
  });
  it("urgent: at-store parcels due today or tomorrow (Taipei)", () => {
    const rows = [
      row("today", { status: "at_store", pickup_deadline: "2026-09-29" }),
      row("tmrw", { status: "at_store", pickup_deadline: "2026-09-30" }),
      row("later", { status: "at_store", pickup_deadline: "2026-10-02" }),
      row("transit", { status: "in_transit", pickup_deadline: "2026-09-29" }),
      row("nodate", { status: "at_store", pickup_deadline: null }),
    ];
    expect(scopeForJob(job("urgent"), rows, T0, caps).rows.map((r) => r.id)).toEqual(["today", "tmrw"]);
  });
  it("health: exactly one row", () => {
    expect(scopeForJob(job("health"), [row("a"), row("b")], T0, caps).rows).toHaveLength(1);
  });
});

describe("jobOutcome", () => {
  it("maps every stop reason", () => {
    expect(jobOutcome({ stopReason: null, tripped: false, checked: 5, capped: false })).toEqual({ status: "done", error: null });
    expect(jobOutcome({ stopReason: null, tripped: false, checked: 5, capped: true })).toEqual({ status: "done", error: "capped" });
    expect(jobOutcome({ stopReason: "time_limit", tripped: false, checked: 5, capped: false })).toEqual({ status: "done", error: "partial" });
    expect(jobOutcome({ stopReason: "seller_cap", tripped: false, checked: 5, capped: false })).toEqual({ status: "done", error: "partial" });
    expect(jobOutcome({ stopReason: "daily_cap", tripped: false, checked: 0, capped: false })).toEqual({ status: "skipped", error: "daily_cap" });
    expect(jobOutcome({ stopReason: "circuit_open", tripped: true, checked: 2, capped: false })).toEqual({ status: "failed", error: "circuit_open" });
  });
  it("taipeiHour", () => {
    expect(taipeiHour(T0)).toBe(10);
    expect(taipeiHour(new Date("2026-09-28T16:30:00Z"))).toBe(0);
  });
});

describe("createWorker().tick", () => {
  it("kill switch off → claims nothing", async () => {
    const sb = fakeSb({ enabled: "false", job: job("manual") });
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: checkOk() });
    expect(await w.tick()).toEqual({ skipped: "disabled" });
    expect(sb.rpcs).toEqual([]);
  });

  it("no queued job → idle", async () => {
    const sb = fakeSb({ job: null });
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: checkOk() });
    expect(await w.tick()).toEqual({ idle: true });
  });

  it("manual job: checks the scope, finishes the job row, sets last_completed_at, writes a health row, emits job-done", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a"), row("b")] });
    const emit = vi.fn();
    const check = checkOk();
    const log = quiet();
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: log, emit, checkRowsImpl: check });
    const out = await w.tick();
    expect(out).toMatchObject({ status: "done", checked: 2, total: 2 });
    const args = check.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(args.deadlineAt).toBe(T0.getTime() + JOB_MAX_MS);
    expect(args.requestBudget).toBe(300);
    expect(args.tag).toBe("[PARCEL-JOB]");
    expect(jobUpdate(sb)!.patch).toMatchObject({ status: "done", error: null, parcels_checked: 2, parcels_total: 2, requests_used: 3 });
    expect(jobUpdate(sb)!.filters).toContainEqual(["eq", "id", "J1"]);
    expect(accessUpdate(sb)!.patch).toEqual({ last_completed_at: T0.toISOString() });
    expect(health(sb)!.patch).toMatchObject({ kind: "manual", job_id: "J1", updated: 2, ok: true });
    expect(emit).toHaveBeenCalledWith("U1", { user_id: "U1", job_id: "J1", kind: "manual", checked: 2, total: 2 });
    // PII-free logs: user id + counts, never a tracking code
    const logged = JSON.stringify([...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(logged).toContain("[PARCEL-JOB] done job=J1 user=U1 kind=manual status=done checked=2/2");
    expect(logged).not.toMatch(/Fa0000000|Fb0000000/);
  });

  it("no fake numbers: a manual job that checked nothing never touches last_completed_at", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a")] });
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: checkOk({ updated: 0, stopReason: "daily_cap" }) });
    expect(await w.tick()).toMatchObject({ status: "skipped", error: "daily_cap", checked: 0 });
    expect(accessUpdate(sb)).toBeUndefined();
  });

  it("only MANUAL jobs set last_completed_at", async () => {
    for (const kind of ["new_parcels", "urgent", "health"]) {
      const sb = fakeSb({ job: job(kind, { requested_at: iso(0) }), rows: [row("a", { status: "at_store", pickup_deadline: "2026-09-29", created_at: iso(0) })] });
      const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: checkOk() });
      await w.tick();
      expect(accessUpdate(sb)).toBeUndefined();
      expect(jobUpdate(sb)!.patch).toMatchObject({ status: "done" });
    }
  });

  it("per-seller daily budget used up → skipped daily_cap without any SHOPMORE request", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a")], todaysJobs: [{ requests_used: 200 }, { requests_used: 99 }] });
    const check = checkOk();
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check });
    expect(await w.tick()).toMatchObject({ status: "skipped", error: "daily_cap" });
    expect(check).not.toHaveBeenCalled();
  });

  it("Pro gets a 600 budget minus today's use", async () => {
    const sb = fakeSb({ plan: "pro", job: job("manual"), rows: [row("a")], todaysJobs: [{ requests_used: 100 }] });
    const check = checkOk();
    await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check }).tick();
    expect((check.mock.calls[0][0] as unknown as Record<string, unknown>).requestBudget).toBe(500);
  });

  it("global daily cap reached → skipped daily_cap", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a")], dailyRequests: 4500 });
    const check = checkOk();
    expect(await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check }).tick()).toMatchObject({ status: "skipped", error: "daily_cap" });
    expect(check).not.toHaveBeenCalled();
  });

  it("time limit mid-job → done/partial; circuit breaker → failed/circuit_open", async () => {
    const sb1 = fakeSb({ job: job("manual"), rows: [row("a"), row("b")] });
    expect(await createWorker({ serviceSb: sb1, now: () => T0, logger: quiet(), checkRowsImpl: checkOk({ updated: 1, stopReason: "time_limit" }) }).tick())
      .toMatchObject({ status: "done", error: "partial", checked: 1, total: 2 });
    const sb2 = fakeSb({ job: job("manual"), rows: [row("a")] });
    expect(await createWorker({ serviceSb: sb2, now: () => T0, logger: quiet(), checkRowsImpl: checkOk({ updated: 0, tripped: true, stopReason: "circuit_open" }) }).tick())
      .toMatchObject({ status: "failed", error: "circuit_open" });
  });

  it("an empty scope finishes done 0/0 without calling checkRows", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a", { last_polled_at: iso(1 * H) })] });
    const check = checkOk();
    expect(await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check }).tick()).toMatchObject({ status: "done", checked: 0, total: 0 });
    expect(check).not.toHaveBeenCalled();
  });

  it("rests 10 minutes after 30 minutes of work, then resumes", async () => {
    let t = T0.getTime();
    const now = () => new Date(t);
    const sb = fakeSb({ job: job("manual"), rows: [row("a")] });
    const check = vi.fn(async () => { t += JOB_MAX_MS + 60_000; return { batchesRun: 1, updated: 1, failures: 0, retired: 0, tripped: false, stopReason: "time_limit", sent: 3 }; });
    const w = createWorker({ serviceSb: sb, now, logger: quiet(), checkRowsImpl: check });
    await w.tick();
    expect(await w.tick()).toEqual({ skipped: "resting" });
    t += REST_MS;
    expect(await w.tick()).not.toEqual({ skipped: "resting" });
  });

  it("queues follow-up new_parcels when rows arrived while the job ran (requested_at = job start)", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a")], freshAfter: true });
    await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: checkOk() }).tick();
    expect(sb.rpcs).toContainEqual({ name: "parcel_tracking_enqueue_job", args: { p_user_id: "U1", p_kind: "new_parcels", p_created_by: "followup", p_requested_at: iso(0) } });
  });

  it("health job: queued once per Taipei day after 09:00, only for PARCEL_HEALTH_USER_ID", async () => {
    const enq = (sb: ReturnType<typeof fakeSb>) => sb.rpcs.filter((r) => r.name === "parcel_tracking_enqueue_job" && r.args.p_kind === "health");
    const sb = fakeSb({ job: null });
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), healthUserId: "GT", checkRowsImpl: checkOk() });
    await w.tick();
    await w.tick();
    expect(enq(sb)).toEqual([{ name: "parcel_tracking_enqueue_job", args: { p_user_id: "GT", p_kind: "health", p_created_by: "worker" } }]);

    const early = fakeSb({ job: null });
    await createWorker({ serviceSb: early, now: () => new Date("2026-09-28T23:00:00Z"), logger: quiet(), healthUserId: "GT", checkRowsImpl: checkOk() }).tick(); // 07:00 Taipei
    expect(enq(early)).toEqual([]);

    const already = fakeSb({ job: null, healthToday: true });
    await createWorker({ serviceSb: already, now: () => T0, logger: quiet(), healthUserId: "GT", checkRowsImpl: checkOk() }).tick();
    expect(enq(already)).toEqual([]);

    const none = fakeSb({ job: null });
    await createWorker({ serviceSb: none, now: () => T0, logger: quiet(), checkRowsImpl: checkOk() }).tick();
    expect(enq(none)).toEqual([]);
  });

  it("claim error (e.g. sql/63 not applied) backs off instead of retrying every tick", async () => {
    let t = T0.getTime();
    const sb = fakeSb({ claimError: { code: "PGRST202" } });
    const w = createWorker({ serviceSb: sb, now: () => new Date(t), logger: quiet(), checkRowsImpl: checkOk() });
    expect(await w.tick()).toEqual({ skipped: "claim_failed" });
    expect(await w.tick()).toEqual({ skipped: "resting" });
    t += 61_000;
    expect(await w.tick()).toEqual({ skipped: "claim_failed" });
  });

  it("a thrown job is marked failed, never left running", async () => {
    const sb = fakeSb({ job: job("manual"), rows: [row("a")] });
    const check = vi.fn(async () => { throw new Error("boom"); });
    expect(await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check }).tick()).toMatchObject({ status: "failed", error: "threw" });
    expect(jobUpdate(sb)!.patch).toMatchObject({ status: "failed", error: "threw" });
  });
});

describe("refund the daily press when a seller's manual check did nothing", () => {
  const refunds = (sb: ReturnType<typeof fakeSb>) => sb.rpcs.filter((r) => r.name === "parcel_tracking_refund_press");
  const run = async (j: Record<string, unknown>, rows: Record<string, unknown>[], check = checkOk(), cfg: Cfg = {}) => {
    const sb = fakeSb({ job: j, rows, ...cfg });
    await createWorker({ serviceSb: sb, now: () => T0, logger: quiet(), checkRowsImpl: check }).tick();
    return sb;
  };

  it("manual/seller with 0 parcels in scope (all checked < 24h ago) → refunded", async () => {
    const sb = await run(job("manual"), [row("a", { last_polled_at: iso(1 * H) })]);
    expect(refunds(sb)).toEqual([{ name: "parcel_tracking_refund_press", args: { p_job_id: "J1" } }]);
    expect(jobUpdate(sb)!.patch).toMatchObject({ status: "done", parcels_total: 0 });
  });
  it("manual/seller with no live parcels at all → refunded", async () => {
    expect(refunds(await run(job("manual"), []))).toHaveLength(1);
  });
  it("manual/seller that checked 3 → press stays consumed", async () => {
    expect(refunds(await run(job("manual"), [row("a"), row("b"), row("c")]))).toEqual([]);
  });
  it("new_parcels with 0 in scope → never refunded", async () => {
    expect(refunds(await run(job("new_parcels", { requested_at: iso(0) }), [row("a", { created_at: iso(5 * H) })]))).toEqual([]);
  });
  it("admin (cron) manual with 0 in scope → never refunded", async () => {
    expect(refunds(await run(job("manual", { created_by: "admin" }), []))).toEqual([]);
  });
  it("failed (worker error) → refunded", async () => {
    const sb = await run(job("manual"), [row("a")], vi.fn(async () => { throw new Error("boom"); }) as never);
    expect(jobUpdate(sb)!.patch).toMatchObject({ status: "failed" });
    expect(refunds(sb)).toHaveLength(1);
  });
  it("skipped daily_cap → not refunded", async () => {
    const sb = await run(job("manual"), [row("a")], checkOk(), { todaysJobs: [{ requests_used: 300 }] });
    expect(jobUpdate(sb)!.patch).toMatchObject({ status: "skipped", error: "daily_cap" });
    expect(refunds(sb)).toEqual([]);
  });
  it("shouldRefundPress matrix", () => {
    const seller = { kind: "manual", created_by: "seller" };
    expect(shouldRefundPress(seller, "done", 0)).toBe(true);
    expect(shouldRefundPress(seller, "failed", 5)).toBe(true);
    expect(shouldRefundPress(seller, "done", 3)).toBe(false);
    expect(shouldRefundPress(seller, "skipped", 0)).toBe(false);
    expect(shouldRefundPress({ kind: "manual", created_by: "admin" }, "failed", 0)).toBe(false);
    expect(shouldRefundPress({ kind: "urgent", created_by: "seller" }, "done", 0)).toBe(false);
    expect(shouldRefundPress({ kind: "health", created_by: "worker" }, "failed", 0)).toBe(false);
  });
});
