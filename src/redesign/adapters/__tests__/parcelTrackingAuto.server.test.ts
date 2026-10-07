// Automatic Pickup Status check — the worker half. Pure helpers (settings with defaults
// and clamps, budget tiers, the parcel order inside an auto job, memory guard) and the
// worker's kind='auto' path with a fake service-role client and an injected checkRows.
import { describe, it, expect, vi } from "vitest";
import {
  AUTO_SETTINGS, AUTO_MODE_KEY, AUTO_SETTING_KEYS, clampSetting, autoSettingsFrom, autoTier, autoScope, overMemoryLimit,
} from "../../../../server/parcelTrackingAuto.js";
import { createWorker, AUTO_STALE_MS } from "../../../../server/parcelTrackingWorker.js";

const T0 = new Date("2026-09-29T02:00:00Z"); // 10:00 Taipei → today 09-29, tomorrow 09-30
const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(T0.getTime() - ms).toISOString();
const DEF = autoSettingsFrom({});
const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "U1", tracking_no: `F${id}`, status: "in_transit", last_polled_at: iso(20 * H), created_at: iso(48 * H), pickup_deadline: null, ...extra });
const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);

describe("settings: defaults and clamps", () => {
  it("every setting falls back to its default when missing or not a number", () => {
    expect(DEF).toEqual({ cooldownHours: 12, dueDays: 3, maxParcels: 200, budgetNormal: 2000, budgetUrgent: 3000, memPct: 70, mode: "off" });
    for (const spec of Object.values(AUTO_SETTINGS)) {
      for (const bad of [undefined, null, "", "abc", "12h", "NaN", "1e3", " "]) expect(clampSetting(bad, spec)).toBe(spec.def);
    }
  });
  it("each setting is clamped to its range", () => {
    const cases: [keyof typeof AUTO_SETTINGS, number, number][] = [
      ["cooldownHours", 4, 48], ["dueDays", 1, 7], ["maxParcels", 20, 600],
      ["budgetNormal", 0, 4500], ["budgetUrgent", 0, 4500], ["memPct", 40, 90],
    ];
    for (const [name, min, max] of cases) {
      const s = AUTO_SETTINGS[name];
      expect([s.min, s.max]).toEqual([min, max]);
      expect(clampSetting(String(min - 1), s)).toBe(min);
      expect(clampSetting(String(max + 1), s)).toBe(max);
      expect(clampSetting(` ${min + 1} `, s)).toBe(min + 1);
      expect(clampSetting("-999999", s)).toBe(min);
    }
    expect(clampSetting("5.6", AUTO_SETTINGS.dueDays)).toBe(6);
  });
  it("the urgent tier never ends below the normal one; mode is off unless list or all", () => {
    expect(autoSettingsFrom({ parcel_tracking_auto_budget_normal: "2500", parcel_tracking_auto_budget_urgent: "1000" }).budgetUrgent).toBe(2500);
    expect(autoSettingsFrom({ [AUTO_MODE_KEY]: " List " }).mode).toBe("list");
    expect(autoSettingsFrom({ [AUTO_MODE_KEY]: "all" }).mode).toBe("all");
    expect(autoSettingsFrom({ [AUTO_MODE_KEY]: "on" }).mode).toBe("off");
    expect(AUTO_SETTING_KEYS).toHaveLength(7);
  });
});

describe("budget tiers (requests used today, all kinds)", () => {
  it("below 2,000 normal · 2,000–2,999 urgent only · 3,000+ skip", () => {
    expect(autoTier(0, DEF)).toBe("normal");
    expect(autoTier(1999, DEF)).toBe("normal");
    expect(autoTier(2000, DEF)).toBe("urgent_only");
    expect(autoTier(2999, DEF)).toBe("urgent_only");
    expect(autoTier(3000, DEF)).toBe("skip");
    expect(autoTier(undefined, DEF)).toBe("normal");
  });
});

describe("autoScope: the order inside an auto job", () => {
  it("due-soon at-store → never checked → stale in-transit/not-found/unknown → far at-store unchecked 3 days", () => {
    const rows = [
      row("far", { status: "at_store", pickup_deadline: "2026-10-09", last_polled_at: iso(80 * H) }),
      row("stale", { status: "not_found", last_polled_at: iso(30 * H) }),
      row("new", { last_polled_at: null }),
      row("due2", { status: "at_store", pickup_deadline: "2026-10-01", last_polled_at: iso(1 * H) }),
      row("due0", { status: "at_store", pickup_deadline: "2026-09-29", last_polled_at: iso(1 * H) }),
      row("fresh", { status: "in_transit", last_polled_at: iso(2 * H) }),         // checked < 12h → out
      row("farFresh", { status: "at_store", pickup_deadline: "2026-10-09", last_polled_at: iso(10 * H) }), // < 3 days → out
      row("staler", { status: "unknown", last_polled_at: iso(40 * H) }),
    ];
    expect(ids(autoScope(rows, T0, DEF))).toEqual(["due0", "due2", "new", "staler", "stale", "far"]);
  });
  it("a seller with MORE than 200 due parcels still gets every due-soon parcel first, nearest deadline first", () => {
    const due = Array.from({ length: 250 }, (_, i) =>
      row(`d${i}`, { status: "at_store", pickup_deadline: `2026-09-${i % 2 ? 30 : 29}`, last_polled_at: iso(1 * H) }));
    const never = Array.from({ length: 50 }, (_, i) => row(`n${i}`, { last_polled_at: null }));
    const out = autoScope([...never, ...due], T0, DEF);
    expect(out.rows).toHaveLength(200);
    expect(out.capped).toBe(true);
    expect(out.rows.every((r) => r.status === "at_store")).toBe(true);
    expect(out.rows.slice(0, 125).every((r) => r.pickup_deadline === "2026-09-29")).toBe(true);
  });
  it("the cap cuts from the end", () => {
    const due = Array.from({ length: 150 }, (_, i) => row(`d${i}`, { status: "at_store", pickup_deadline: "2026-09-30" }));
    const never = Array.from({ length: 100 }, (_, i) => row(`n${i}`, { last_polled_at: null }));
    const out = autoScope([...never, ...due], T0, DEF);
    expect(ids(out).slice(0, 150).every((x) => x.startsWith("d"))).toBe(true);
    expect(ids(out).slice(150)).toEqual(never.slice(0, 50).map((r) => r.id));
  });
  it("due-soon window follows the due-days setting; a parcel is never listed twice", () => {
    const rows = [row("d5", { status: "at_store", pickup_deadline: "2026-10-04", last_polled_at: null })];
    expect(ids(autoScope(rows, T0, DEF))).toEqual(["d5"]);                         // as never-checked, once
    expect(ids(autoScope(rows, T0, { ...DEF, dueDays: 7 }))).toEqual(["d5"]);
  });
  it("urgent-only tier = at-store parcels due today or tomorrow only", () => {
    const rows = [
      row("t", { status: "at_store", pickup_deadline: "2026-09-29" }),
      row("tm", { status: "at_store", pickup_deadline: "2026-09-30" }),
      row("d2", { status: "at_store", pickup_deadline: "2026-10-01" }),
      row("new", { last_polled_at: null }),
    ];
    expect(ids(autoScope(rows, T0, DEF, "urgent_only"))).toEqual(["t", "tm"]);
  });
});

describe("memory guard", () => {
  it("over memPct of the instance RAM", () => {
    expect(overMemoryLimit(359 * 1024 * 1024, 512, 70)).toBe(true);
    expect(overMemoryLimit(358 * 1024 * 1024, 512, 70)).toBe(false);
    expect(overMemoryLimit(undefined, 512, 70)).toBe(false);
  });
});

// ── the worker's auto path ────────────────────────────────────────────────────
type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
function fakeSb(cfg: { settings?: Record<string, string>; rows?: Record<string, unknown>[]; dailyRequests?: number; plan?: string } = {}) {
  const queries: Q[] = [];
  const settings = { parcel_tracking_enabled: "true", [AUTO_MODE_KEY]: "all", ...(cfg.settings ?? {}) };
  const resolve = (q: Q) => {
    if (q.table === "app_settings") {
      const keys = (q.filters.find((f) => f[0] === "in")?.[2] as string[]) ?? [];
      return { data: Object.entries(settings).filter(([k]) => keys.includes(k)).map(([key, value]) => ({ key, value })), error: null };
    }
    if (q.table === "seller_profiles") return { data: { plan: cfg.plan ?? "plus", role: "seller" }, error: null };
    if (q.table === "parcel_tracking_daily") return { data: { requests: cfg.dailyRequests ?? 0 }, error: null };
    if (q.table === "parcel_tracking_jobs" && q.op === "select") return { data: [], error: null };
    if (q.table === "parcel_tracking" && q.op === "select") {
      if (q.filters.some((f) => f[0] === "is")) return { data: [], error: null };
      const r = q.filters.find((f) => f[0] === "range") as [string, number, number];
      return { data: (cfg.rows ?? []).slice(r[1], r[2] + 1), error: null };
    }
    return { data: [], error: null };
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
  return { from, rpc: vi.fn(async (_name: string): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })), queries };
}
const autoJob = (extra: Record<string, unknown> = {}) =>
  ({ id: "J9", user_id: "U1", kind: "auto", status: "running", created_by: "auto", requested_at: iso(60_000), started_at: iso(0), ...extra });
const checkOk = () => vi.fn(async (a: { rows: unknown[]; limits?: { dailyRequestCap: number } }) => ({
  batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: 0, tripped: false, stopReason: null, sent: 4,
}));
const logs = () => { const lines: string[] = []; return { lines, log: (...a: unknown[]) => lines.push(a.join(" ")), warn: vi.fn(), error: vi.fn() }; };
async function run(cfg: Parameters<typeof fakeSb>[0], job = autoJob(), extra: Record<string, unknown> = {}) {
  const sb = fakeSb(cfg);
  const checkRowsImpl = checkOk();
  const logger = logs();
  const w = createWorker({
    serviceSb: sb, now: () => T0, logger, checkRowsImpl,
    memoryUsage: () => ({ rss: 100 * 1024 * 1024 }), loopDelay: () => () => ({ p99: 12, max: 40 }), ...extra,
  });
  const out = await runOne(w, sb, job);
  return { sb, checkRowsImpl, logger, out };
}
// The worker runs a job through tick(); feed the claim RPC the job.
async function runOne(w: ReturnType<typeof createWorker>, sb: ReturnType<typeof fakeSb>, job: Record<string, unknown>) {
  sb.rpc.mockImplementation(async (name: string) => (name === "parcel_tracking_claim_job" ? { data: [job], error: null } : { data: null, error: null }));
  return w.tick();
}
const jobUpdate = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_jobs" && q.op === "update")?.patch as Record<string, unknown>;
const due = (n: number) => Array.from({ length: n }, (_, i) => row(`d${i}`, { status: "at_store", pickup_deadline: "2026-09-30" }));

describe("worker: kind='auto'", () => {
  it("mode off → skipped auto_off, nothing checked", async () => {
    const { sb, checkRowsImpl } = await run({ settings: { [AUTO_MODE_KEY]: "off" }, rows: due(3) });
    expect(jobUpdate(sb)).toMatchObject({ status: "skipped", error: "auto_off" });
    expect(checkRowsImpl).not.toHaveBeenCalled();
  });
  it("a job queued over an hour ago (worker was off) is dropped as stale", async () => {
    const { sb, checkRowsImpl } = await run({ rows: due(3) }, autoJob({ requested_at: iso(AUTO_STALE_MS + 60_000) }));
    expect(jobUpdate(sb)).toMatchObject({ status: "skipped", error: "auto_stale" });
    expect(checkRowsImpl).not.toHaveBeenCalled();
  });
  it("memory guard: RSS over memPct → skipped memory", async () => {
    const { sb, checkRowsImpl } = await run({ rows: due(3), settings: { parcel_tracking_auto_mem_pct: "50" } }, autoJob(),
      { memoryUsage: () => ({ rss: 300 * 1024 * 1024 }) });
    expect(jobUpdate(sb)).toMatchObject({ status: "skipped", error: "memory" });
    expect(checkRowsImpl).not.toHaveBeenCalled();
  });
  it("3,000+ requests today → skipped auto_budget", async () => {
    const { sb, checkRowsImpl } = await run({ rows: due(3), dailyRequests: 3000 });
    expect(jobUpdate(sb)).toMatchObject({ status: "skipped", error: "auto_budget" });
    expect(checkRowsImpl).not.toHaveBeenCalled();
  });
  it("2,000–2,999 → only parcels due today/tomorrow, and the run stops at the urgent tier", async () => {
    const rows = [...due(2), row("later", { status: "at_store", pickup_deadline: "2026-10-02" }), row("new", { last_polled_at: null })];
    const { checkRowsImpl } = await run({ rows, dailyRequests: 2500 });
    const arg = checkRowsImpl.mock.calls[0][0] as unknown as { rows: { id: string }[]; limits: { dailyRequestCap: number } };
    expect(arg.rows.map((r) => r.id)).toEqual(["d0", "d1"]);
    expect(arg.limits.dailyRequestCap).toBe(3000);
  });
  it("normal tier checks up to 200 parcels in the auto order and sets Last checked", async () => {
    const { sb, checkRowsImpl } = await run({ rows: [...Array.from({ length: 60 }, (_, i) => row(`n${i}`, { last_polled_at: null })), ...due(180)] });
    const arg = checkRowsImpl.mock.calls[0][0] as unknown as { rows: { id: string }[] };
    expect(arg.rows).toHaveLength(200);
    expect(arg.rows.slice(0, 180).every((r) => r.id.startsWith("d"))).toBe(true);
    expect(jobUpdate(sb)).toMatchObject({ status: "done", error: "capped", parcels_checked: 200 });
    expect(sb.queries.some((q) => q.table === "parcel_tracking_access" && q.op === "update")).toBe(true);
  });
  it("the done line has seller id, counts, RSS and loop delay — never tracking numbers or handles", async () => {
    const { logger } = await run({ rows: [row("x", { last_polled_at: null, tracking_no: "F12345678", buyer_username: "maria" })] });
    const done = logger.lines.find((l) => l.includes(" done "))!;
    expect(done).toMatch(/user=U1 kind=auto status=done checked=1\/1 requests=4 \d+ms rss=100MB loop_p99=12ms loop_max=40ms$/);
    expect(logger.lines.join("\n")).not.toMatch(/F12345678|maria/);
  });
  it("manual jobs never read the auto settings and keep the 4,500 cap", async () => {
    const sb = fakeSb({ rows: [row("a", { last_polled_at: null })], dailyRequests: 3500 });
    const checkRowsImpl = checkOk();
    const w = createWorker({ serviceSb: sb, now: () => T0, logger: logs(), checkRowsImpl, memoryUsage: () => ({ rss: 1 }) });
    await runOne(w, sb, { ...autoJob(), kind: "manual", created_by: "seller" });
    expect(sb.queries.filter((q) => q.table === "app_settings").every((q) => !(q.filters.find((f) => f[0] === "in")?.[2] as string[]).includes(AUTO_MODE_KEY))).toBe(true);
    expect(checkRowsImpl.mock.calls[0][0].limits?.dailyRequestCap).toBe(4500);
  });
});
