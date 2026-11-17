// Pickup Status 7-11 check flow (Jeff, 2026-11-17): server/pickupRules.js + the worker.
//   • 2-day rule (Taipei calendar days), at-store always checkable
//   • order: at-store first (passed / nearest deadline, no deadline last), then least recently checked
//   • "Check now" = every checkable parcel, no parcel cap, manual budget 1,100
//   • no 7-11 check in a 'new_parcels' job (no check at Sync), no follow-up job
//   • the health probe always finds a row; the automatic check skips young parcels
import { describe, it, expect, vi } from "vitest";
import {
  taipeiDayOf, taipeiDaysSince, isCheckable, splitCheckable, orderForCheck, CHECK_AFTER_DAYS,
} from "../../../../server/pickupRules.js";
import {
  createWorker, sevenScopeForJob, scopeForJob, sellerRequestBudget, MANUAL_REQUEST_BUDGET, planCaps,
} from "../../../../server/parcelTrackingWorker.js";
import { AUTO_MODE_KEY } from "../../../../server/parcelTrackingAuto.js";

// Wednesday 2026-11-18 00:00 Taipei = 2026-11-17T16:00:00Z
const WED_0000 = new Date("2026-11-17T16:00:00Z");
const TUE_2359 = new Date("2026-11-17T15:59:00Z");
const MON_0001 = "2026-11-15T16:01:00Z";   // Monday 00:01 Taipei
const MON_2359 = "2026-11-16T15:59:00Z";   // Monday 23:59 Taipei
const SUN_2359 = "2026-11-15T15:59:00Z";   // Sunday 23:59 Taipei

describe("2-day rule (Asia/Taipei calendar days)", () => {
  it("Taipei day boundaries: 15:59Z and 16:00Z fall on different Taipei days", () => {
    expect(taipeiDayOf("2026-11-16T15:59:59Z")).toBe("2026-11-16");
    expect(taipeiDayOf("2026-11-16T16:00:00Z")).toBe("2026-11-17");
    expect(taipeiDayOf("not a date")).toBe("");
  });
  it("synced Monday (00:01 or 23:59) → not checkable Tuesday 23:59, checkable Wednesday 00:00", () => {
    for (const created_at of [MON_0001, MON_2359]) {
      const r = { status: "in_transit", created_at };
      expect(isCheckable(r, TUE_2359)).toBe(false);
      expect(isCheckable(r, WED_0000)).toBe(true);
    }
    expect(taipeiDaysSince(MON_2359, WED_0000)).toBe(CHECK_AFTER_DAYS);
  });
  it("synced Sunday 23:59 → checkable Tuesday (2 Taipei days later), whatever the hours", () => {
    expect(isCheckable({ status: "created", created_at: SUN_2359 }, new Date("2026-11-16T16:00:00Z"))).toBe(true);
  });
  it("every status that is not at a store waits: created, in_transit, not_found, unknown", () => {
    for (const status of ["created", "in_transit", "not_found", "unknown"]) {
      expect(isCheckable({ status, created_at: MON_2359 }, TUE_2359)).toBe(false);
    }
  });
  it("at a store: always checkable, even synced today", () => {
    expect(isCheckable({ status: "at_store", created_at: "2026-11-17T15:58:00Z" }, TUE_2359)).toBe(true);
  });
  it("no readable sync date → checkable (a row is never stuck)", () => {
    expect(isCheckable({ status: "in_transit", created_at: null }, TUE_2359)).toBe(true);
  });
  it("splitCheckable keeps order and puts young rows aside", () => {
    const rows = [
      { id: "a", status: "in_transit", created_at: MON_2359 },
      { id: "b", status: "in_transit", created_at: "2026-11-10T00:00:00Z" },
      { id: "c", status: "at_store", created_at: MON_2359 },
    ];
    const s = splitCheckable(rows, TUE_2359);
    expect(s.rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(s.young.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("check order", () => {
  const r = (id: string, status: string, pickup_deadline: string | null, last_polled_at: string | null) => ({ id, status, pickup_deadline, last_polled_at });
  it("at-store first (passed deadline, then nearest, no deadline last), then the rest least recently checked (never checked first)", () => {
    const rows = [
      r("transitOld", "in_transit", null, "2026-11-01T00:00:00Z"),
      r("storeLate", "at_store", "2026-11-25", "2026-11-17T00:00:00Z"),
      r("never", "in_transit", null, null),
      r("storeNoDate", "at_store", null, "2026-10-01T00:00:00Z"),
      r("storePassed", "at_store", "2026-11-10", "2026-11-16T00:00:00Z"),
      r("notFound", "not_found", null, "2026-10-20T00:00:00Z"),
      r("storeNear", "at_store", "2026-11-18", "2026-11-16T00:00:00Z"),
      r("transitNew", "in_transit", null, "2026-11-17T00:00:00Z"),
    ];
    expect(orderForCheck(rows).map((x) => x.id)).toEqual([
      "storePassed", "storeNear", "storeLate", "storeNoDate", "never", "notFound", "transitOld", "transitNew",
    ]);
  });
  it("same deadline → least recently checked first; equal keys keep the given order; input untouched", () => {
    const rows = [
      r("s2", "at_store", "2026-11-20", "2026-11-17T00:00:00Z"),
      r("s1", "at_store", "2026-11-20", "2026-11-10T00:00:00Z"),
      r("t1", "in_transit", null, "2026-11-10T00:00:00Z"),
      r("t2", "in_transit", null, "2026-11-10T00:00:00Z"),
    ];
    const before = rows.map((x) => x.id);
    expect(orderForCheck(rows).map((x) => x.id)).toEqual(["s1", "s2", "t1", "t2"]);
    expect(rows.map((x) => x.id)).toEqual(before);
  });
});

describe("sevenScopeForJob", () => {
  const caps = planCaps("plus");
  const job = (kind: string) => ({ kind, requested_at: "2026-11-17T00:00:00Z" });
  it("manual: every checkable row, never capped (2,500 rows)", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `r${i}`, status: "in_transit", last_polled_at: null }));
    const s = sevenScopeForJob(job("manual"), rows, TUE_2359, caps);
    expect(s.rows).toHaveLength(2500);
    expect(s.capped).toBe(false);
  });
  it("new_parcels: no 7-11 parcel (no check at Sync)", () => {
    const rows = [{ id: "a", status: "created", last_polled_at: null, created_at: "2026-11-17T15:00:00Z" }];
    expect(sevenScopeForJob(job("new_parcels"), rows, TUE_2359, caps).rows).toEqual([]);
  });
  it("health: exactly one row, the first in check order", () => {
    const rows = [{ id: "t", status: "in_transit", last_polled_at: null }, { id: "s", status: "at_store", pickup_deadline: "2026-11-20", last_polled_at: null }];
    expect(sevenScopeForJob(job("health"), rows, TUE_2359, caps).rows.map((x: { id: string }) => x.id)).toEqual(["s"]);
  });
  it("urgent: exactly the old scope (at-store due today or tomorrow, plan cap)", () => {
    const rows = [
      { id: "today", status: "at_store", pickup_deadline: "2026-11-17" },
      { id: "later", status: "at_store", pickup_deadline: "2026-11-25" },
    ];
    expect(sevenScopeForJob(job("urgent"), rows, TUE_2359, caps)).toEqual(scopeForJob(job("urgent"), rows, TUE_2359, caps));
  });
  it("budget: manual 1,100 on every plan; other kinds keep the plan numbers", () => {
    expect(sellerRequestBudget("manual", planCaps("plus"))).toBe(1100);
    expect(sellerRequestBudget("manual", planCaps("master"))).toBe(MANUAL_REQUEST_BUDGET);
    expect(sellerRequestBudget("urgent", planCaps("plus"))).toBe(300);
    expect(sellerRequestBudget("auto", planCaps("pro"))).toBe(600);
  });
});

// ── the worker ─────────────────────────────────────────────────────────────────
type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
type Cfg = { rows?: Record<string, unknown>[]; otherRows?: Record<string, unknown>[]; accessIds?: string[]; profiles?: Record<string, unknown>[]; settings?: Record<string, string>; todaysJobs?: { requests_used: number }[] };
function fakeSb(cfg: Cfg = {}) {
  const queries: Q[] = [];
  const rpcs: { name: string; args: unknown }[] = [];
  const settings = { parcel_tracking_enabled: "true", [AUTO_MODE_KEY]: "all", ...(cfg.settings ?? {}) };
  const resolve = (q: Q) => {
    const has = (k: string) => q.filters.some((f) => f[0] === k);
    if (q.table === "app_settings") {
      const keys = (q.filters.find((f) => f[0] === "in")?.[2] as string[]) ?? [];
      return { data: Object.entries(settings).filter(([k]) => keys.includes(k)).map(([key, value]) => ({ key, value })), error: null };
    }
    if (q.table === "seller_profiles" && has("in")) return { data: cfg.profiles ?? [], error: null };
    if (q.table === "seller_profiles") return { data: { plan: "plus", role: "seller", plan_status: "active", plan_expiry: null }, error: null };
    if (q.table === "parcel_tracking_access" && q.op === "select") return { data: (cfg.accessIds ?? []).map((user_id) => ({ user_id })), error: null };
    if (q.table === "parcel_tracking_daily") return { data: { requests: 0 }, error: null };
    if (q.table === "parcel_tracking_jobs" && q.op === "select") return { data: cfg.todaysJobs ?? [], error: null };
    if (q.table === "parcel_tracking" && q.op === "select") {
      const r = q.filters.find((f) => f[0] === "range") as [string, number, number] | undefined;
      if (!r) return { data: cfg.otherRows ?? [], error: null };
      return { data: (cfg.rows ?? []).slice(r[1], r[2] + 1), error: null };
    }
    return { data: [], error: null };
  };
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [], patch: null };
    queries.push(q);
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, rj?: (e: unknown) => unknown) => Promise.resolve(resolve(q)).then(f, rj);
        return (...args: unknown[]) => {
          if (["update", "insert", "delete", "upsert"].includes(k)) { q.op = k; q.patch = args[0]; }
          else if (k !== "select" && k !== "maybeSingle") q.filters.push([k, ...args]);
          return ch;
        };
      },
    });
    return ch;
  };
  let jobForClaim: Record<string, unknown> | null = null;
  const rpc = (name: string, args: unknown = {}) => {
    rpcs.push({ name, args });
    if (name === "parcel_tracking_claim_job") return Promise.resolve({ data: jobForClaim ? [jobForClaim] : [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return { from, rpc, queries, rpcs, setJob: (j: Record<string, unknown>) => { jobForClaim = j; } };
}
const NOW = TUE_2359;
const iso = (s: string) => s;
const job = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ id: "J1", user_id: "U1", kind, status: "running", created_by: kind === "manual" ? "seller" : kind, requested_at: new Date(NOW.getTime() - 60_000).toISOString(), started_at: NOW.toISOString(), ...extra });
const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "U1", tracking_no: `F${id}TN`, status: "in_transit", last_polled_at: null, created_at: iso("2026-11-10T00:00:00Z"), ...extra });
const youngRow = (id: string, extra: Record<string, unknown> = {}) => row(id, { created_at: MON_2359, ...extra });
const checkOk = (over: Record<string, unknown> = {}) => vi.fn(async (a: { rows: unknown[] }) => ({
  batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0, tripped: false, stopReason: null, sent: 3, ...over,
}));
const logs = () => { const lines: string[] = []; const push = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); }; return { lines, log: push, warn: push, error: push }; };
async function runJob(kind: string, cfg: Cfg, extra: Record<string, unknown> = {}, jobExtra: Record<string, unknown> = {}) {
  const sb = fakeSb(cfg);
  sb.setJob(job(kind, jobExtra));
  const check = checkOk();
  const logger = logs();
  const out = await createWorker({ serviceSb: sb, now: () => NOW, logger, checkRowsImpl: check, memoryUsage: () => ({ rss: 1 }), loopDelay: () => () => ({ p99: 1, max: 1 }), ...extra }).tick();
  const checked = check.mock.calls.length ? (check.mock.calls[0][0] as unknown as { rows: { id: string }[]; requestBudget: number }) : null;
  return { sb, out, check, checked, logger };
}
const jobPatch = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_jobs" && q.op === "update")?.patch as Record<string, unknown>;

describe("worker: Check now under the new rules", () => {
  it("checks every checkable parcel in check order, leaves young ones out (nothing written for them)", async () => {
    const rows = [
      youngRow("y1"), row("t1", { last_polled_at: "2026-11-15T00:00:00Z" }), youngRow("y2", { status: "created" }),
      row("s1", { status: "at_store", pickup_deadline: "2026-11-20", last_polled_at: "2026-11-17T00:00:00Z" }),
      youngRow("s2", { status: "at_store", pickup_deadline: "2026-11-12", last_polled_at: "2026-11-17T00:00:00Z" }),
      row("n1"),
    ];
    const { checked, sb, logger, out } = await runJob("manual", { rows });
    expect(checked!.rows.map((r) => r.id)).toEqual(["s2", "s1", "n1", "t1"]);
    expect(checked!.requestBudget).toBe(1100);
    expect(out).toMatchObject({ status: "done", total: 4 });
    expect(jobPatch(sb)).toMatchObject({ error: null, parcels_total: 4 });
    expect(sb.queries.some((q) => q.table === "parcel_tracking" && q.op === "update")).toBe(false); // young rows untouched
    const done = logger.lines.find((l) => l.includes(" done "))!;
    expect(done).toContain("young_skipped=2");
    expect(logger.lines.join("\n")).not.toMatch(/F[a-z0-9]+TN/); // never a tracking number
  });
  it("no parcel cap: 2,500 checkable parcels all go to the check (a Plus seller)", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(`r${i}`));
    const { checked, sb } = await runJob("manual", { rows });
    expect(checked!.rows).toHaveLength(2500);
    expect(jobPatch(sb)).toMatchObject({ error: null, parcels_total: 2500 });
  });
  it("a check stopped by the 30-min limit is reported partial (at-store parcels went first)", async () => {
    const rows = [row("t1"), row("s1", { status: "at_store", pickup_deadline: "2026-11-20" })];
    const sb = fakeSb({ rows });
    sb.setJob(job("manual"));
    const check = checkOk({ updated: 1, stopReason: "time_limit" });
    const out = await createWorker({ serviceSb: sb, now: () => NOW, logger: logs(), checkRowsImpl: check }).tick();
    expect((check.mock.calls[0][0] as unknown as { rows: { id: string }[] }).rows[0].id).toBe("s1");
    expect(out).toMatchObject({ status: "done", error: "partial", checked: 1, total: 2 });
  });
  it("only young parcels → nothing checked, done 0/0, the seller's press is given back", async () => {
    const { check, sb } = await runJob("manual", { rows: [youngRow("y1"), youngRow("y2")] });
    expect(check).not.toHaveBeenCalled();
    expect(jobPatch(sb)).toMatchObject({ status: "done", parcels_total: 0 });
    expect(sb.rpcs.some((r) => r.name === "parcel_tracking_refund_press")).toBe(true);
  });
  it("the 1,100 budget counts every job of the seller today", async () => {
    const { check, out } = await runJob("manual", { rows: [row("a")], todaysJobs: [{ requests_used: 1095 }] });
    expect(check).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "skipped", error: "daily_cap" });
  });
});

describe("worker: no 7-11 check at Sync", () => {
  it("a new_parcels job checks no 7-11 parcel and queues no follow-up; its 全家 part is still asked", async () => {
    const planFmImpl = vi.fn(async () => null);
    const { check, sb, out } = await runJob("new_parcels", { rows: [row("never"), youngRow("fresh")] }, { planFmImpl });
    expect(check).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "done", total: 0 });
    expect(planFmImpl).toHaveBeenCalledTimes(1);
    expect(sb.rpcs.filter((r) => r.name === "parcel_tracking_enqueue_job")).toEqual([]);
  });
});

describe("worker: the daily health probe always finds a row", () => {
  it("own checkable row → that one", async () => {
    const { checked } = await runJob("health", { rows: [youngRow("y"), row("own")], otherRows: [row("other", { user_id: "U2" })], accessIds: ["U2"] });
    expect(checked!.rows.map((r) => r.id)).toEqual(["own"]);
  });
  it("no own checkable row → one checkable row of an active seller (young and expired-seller rows skipped)", async () => {
    const otherRows = [
      youngRow("young", { user_id: "U2" }),
      row("other", { user_id: "U2" }),
      row("other2", { user_id: "U2" }),
    ];
    const { checked, out } = await runJob("health", {
      rows: [youngRow("y")], otherRows, accessIds: ["U2", "U3"],
      profiles: [{ auth_user_id: "U2", role: "seller", plan_status: "active", plan_expiry: null }, { auth_user_id: "U3", plan_status: "expired" }],
    });
    expect(checked!.rows.map((r) => r.id)).toEqual(["other"]);
    expect(out).toMatchObject({ status: "done", total: 1 });
  });
  it("the fallback read asks only enabled, unexpired sellers' unfinished 7-11 rows", async () => {
    const { sb } = await runJob("health", {
      rows: [], otherRows: [row("other", { user_id: "U2" })], accessIds: ["U2", "U3"],
      profiles: [{ auth_user_id: "U2", plan_status: "active" }, { auth_user_id: "U3", plan_status: "expired" }],
    });
    const q = sb.queries.find((x) => x.table === "parcel_tracking" && x.op === "select" && !x.filters.some((f) => f[0] === "range"))!;
    expect(q.filters).toContainEqual(["eq", "terminal", false]);
    expect(q.filters).toContainEqual(["eq", "carrier", "711"]);
    expect(q.filters).toContainEqual(["in", "user_id", ["U2"]]);
  });
  it("nobody has a checkable row → done 0/0, nothing checked", async () => {
    const { check, out } = await runJob("health", { rows: [], otherRows: [youngRow("y", { user_id: "U2" })], accessIds: ["U2"], profiles: [] });
    expect(check).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "done", total: 0 });
  });
});

describe("worker: the automatic check skips young parcels (its own limits unchanged)", () => {
  it("never-checked young parcels are left out; older ones and at-store ones are checked", async () => {
    const rows = [youngRow("young"), row("old"), youngRow("store", { status: "at_store", pickup_deadline: "2026-11-18", last_polled_at: "2026-11-17T00:00:00Z" })];
    const { checked } = await runJob("auto", { rows });
    expect(checked!.rows.map((r) => r.id).sort()).toEqual(["old", "store"]);
    expect(checked!.requestBudget).toBe(300); // the plan budget, not the manual one
  });
});
