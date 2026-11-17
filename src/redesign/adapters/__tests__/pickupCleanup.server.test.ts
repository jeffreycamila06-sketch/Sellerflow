// Night cleanup run (Jeff, 2026-11-17): 02:00–05:00 Taipei, only while no job is waiting, at most 600
// rows a night (counted from the database), candidates = unfinished 7-11 rows whose SAVED answer is
// "not dropped off yet" and synced 10+ Taipei days ago; the decision is made on the FRESH answer.
import { describe, it, expect, vi } from "vitest";
import {
  createWorker, inCleanupWindow, cleanupRowsUsed, cleanupCreatedBefore, CLEANUP_NIGHT_MAX, CLEANUP_CHUNK,
} from "../../../../server/parcelTrackingWorker.js";
import { checkRows } from "../../../../server/parcelTrackingRunner.js";
import { QUERY_URL, SEARCH_URL } from "../../../../server/parcelTracking.js";

const ND = "訂單已成立，尚未至門市寄件";
const at = (taipei: string) => new Date(`${taipei}+08:00`);
const NIGHT = at("2026-11-18T03:00:00");

type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
type Cfg = { enabled?: string; job?: Record<string, unknown> | null; health?: { updated: number; errors: number }[]; accessIds?: string[]; profiles?: Record<string, unknown>[]; candidates?: Record<string, unknown>[]; dailyRequests?: number };
function fakeSb(cfg: Cfg = {}) {
  const queries: Q[] = [];
  const resolve = (q: Q) => {
    if (q.table === "app_settings") return { data: [{ key: "parcel_tracking_enabled", value: cfg.enabled ?? "true" }], error: null };
    if (q.table === "parcel_tracking_health" && q.op === "select") return { data: cfg.health ?? [], error: null };
    if (q.table === "parcel_tracking_access") return { data: (cfg.accessIds ?? ["U1"]).map((user_id) => ({ user_id })), error: null };
    if (q.table === "seller_profiles") return { data: cfg.profiles ?? [], error: null };
    if (q.table === "parcel_tracking_daily") return { data: { requests: cfg.dailyRequests ?? 0 }, error: null };
    if (q.table === "parcel_tracking" && q.op === "select") {
      const lim = (q.filters.find((f) => f[0] === "limit")?.[1] as number) ?? 1000;
      return { data: (cfg.candidates ?? []).slice(0, lim), error: null };
    }
    if (q.table === "parcel_tracking_jobs") return { data: [], error: null };
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
  const rpc = vi.fn(async (name: string) => (name === "parcel_tracking_claim_job" ? { data: cfg.job ? [cfg.job] : [], error: null } : { data: null, error: null }));
  return { from, rpc, queries };
}
const cand = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "U1", tracking_no: `F${id}99999`, status: "in_transit", status_message: ND, unchanged_polls: 0, created_at: "2026-11-01T00:00:00Z", last_polled_at: "2026-11-10T00:00:00Z", ...extra });
const checkOk = (over: Record<string, unknown> = {}) => vi.fn(async (a: { rows: unknown[] }) => ({
  batchesRun: 1, updated: a.rows.length, unknowns: 0, notFound: 0, captchaFails: 0, failures: 0, retired: a.rows.length, notDropped: a.rows.length, tripped: false, stopReason: null, sent: 3, ...over,
}));
const logs = () => { const lines: string[] = []; const p = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); }; return { lines, log: p, warn: p, error: p }; };
const healthInsert = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking_health" && q.op === "insert")?.patch as Record<string, unknown> | undefined;
const candidateRead = (sb: ReturnType<typeof fakeSb>) => sb.queries.find((q) => q.table === "parcel_tracking" && q.op === "select");

describe("night cleanup — pure parts", () => {
  it("window is 02:00–04:59 Taipei", () => {
    expect(inCleanupWindow(at("2026-11-18T01:59:00"))).toBe(false);
    expect(inCleanupWindow(at("2026-11-18T02:00:00"))).toBe(true);
    expect(inCleanupWindow(at("2026-11-18T04:59:00"))).toBe(true);
    expect(inCleanupWindow(at("2026-11-18T05:00:00"))).toBe(false);
  });
  it("10 Taipei calendar days: on the 18th, synced before the 9th 00:00 Taipei", () => {
    expect(cleanupCreatedBefore(NIGHT)).toBe(at("2026-11-09T00:00:00").toISOString());
  });
  it("rows used tonight = answered rows + 6 per failed batch", () => {
    expect(cleanupRowsUsed([{ updated: 50, errors: 0 }, { updated: 40, errors: 2 }])).toBe(102);
    expect(cleanupRowsUsed([])).toBe(0);
  });
});

describe("night cleanup — in the worker", () => {
  const run = async (cfg: Cfg, now = NIGHT, check = checkOk()) => {
    const sb = fakeSb(cfg);
    const logger = logs();
    const out = await createWorker({ serviceSb: sb, now: () => now, logger, checkRowsImpl: check }).tick();
    return { sb, out, check, logger };
  };
  it("outside 02:00–05:00 → never runs", async () => {
    const { out, check, sb } = await run({ candidates: [cand("a")] }, at("2026-11-18T05:00:00"));
    expect(out).toEqual({ idle: true });
    expect(check).not.toHaveBeenCalled();
    expect(candidateRead(sb)).toBeUndefined();
  });
  it("a job waiting → the job runs, the cleanup does not", async () => {
    const job = { id: "J", user_id: "U9", kind: "manual", created_by: "seller", requested_at: NIGHT.toISOString(), started_at: NIGHT.toISOString() };
    const { sb } = await run({ job, candidates: [cand("a")] });
    expect(sb.queries.some((q) => q.table === "parcel_tracking_health" && q.op === "select")).toBe(false);
    expect(healthInsert(sb)?.kind).toBe("manual");
  });
  it("kill switch off → nothing", async () => {
    const { check, out } = await run({ enabled: "false", candidates: [cand("a")] });
    expect(out).toEqual({ skipped: "disabled" });
    expect(check).not.toHaveBeenCalled();
  });
  it("reads the right candidates and hands them to the check; health row kind 'cleanup'; count-only log", async () => {
    const { sb, check, out, logger } = await run({
      candidates: [cand("a"), cand("b")], accessIds: ["U1", "U2"],
      profiles: [{ auth_user_id: "U1", plan_status: "active" }, { auth_user_id: "U2", plan_status: "expired" }],
    });
    const q = candidateRead(sb)!;
    expect(q.filters).toEqual(expect.arrayContaining([
      ["eq", "terminal", false], ["eq", "carrier", "711"], ["eq", "status", "in_transit"],
      ["like", "status_message", "%尚未至門市寄件%"], ["lt", "created_at", cleanupCreatedBefore(NIGHT)],
      ["in", "user_id", ["U1"]], ["limit", CLEANUP_CHUNK],
    ]));
    expect((check.mock.calls[0][0] as unknown as { rows: { id: string }[]; tag: string }).rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(healthInsert(sb)).toMatchObject({ kind: "cleanup", updated: 2, retired: 2, requests: 3 });
    expect(out).toMatchObject({ idle: true, cleanup: "ran", checked: 2, left: 2 });
    const all = logger.lines.join("\n");
    expect(all).toContain("[PARCEL-CLEANUP] checked=2/2 left_pickup_status=2 sellers=1 requests=3 tonight=2/600");
    expect(all).not.toMatch(/F[ab]99999/);
    expect(all).not.toContain(ND);
  });
  it("night limit counted from the database: 580 used → only 20 more; 600 → none (and no more reads tonight)", async () => {
    const a = await run({ health: [{ updated: 580, errors: 0 }], candidates: Array.from({ length: 60 }, (_, i) => cand(`r${i}`)) });
    expect(candidateRead(a.sb)!.filters).toContainEqual(["limit", 20]);
    const sb = fakeSb({ health: [{ updated: 594, errors: 1 }], candidates: [cand("a")] });
    const check = checkOk();
    const w = createWorker({ serviceSb: sb, now: () => NIGHT, logger: logs(), checkRowsImpl: check });
    expect(await w.tick()).toEqual({ idle: true, cleanup: "night_limit" });
    expect(check).not.toHaveBeenCalled();
    await w.tick();
    expect(sb.queries.filter((q) => q.table === "parcel_tracking_health" && q.op === "select")).toHaveLength(1);
    expect(CLEANUP_NIGHT_MAX).toBe(600);
  });
  it("nothing to do → waits 30 minutes before looking again", async () => {
    let t = NIGHT.getTime();
    const sb = fakeSb({ candidates: [] });
    const w = createWorker({ serviceSb: sb, now: () => new Date(t), logger: logs(), checkRowsImpl: checkOk() });
    expect(await w.tick()).toEqual({ idle: true, cleanup: "nothing" });
    t += 10 * 60 * 1000;
    expect(await w.tick()).toEqual({ idle: true });
    t += 21 * 60 * 1000;
    expect(await w.tick()).toEqual({ idle: true, cleanup: "nothing" });
  });
  it("global daily cap reached → no request", async () => {
    const { check, out } = await run({ candidates: [cand("a")], dailyRequests: 4500 });
    expect(check).not.toHaveBeenCalled();
    expect(out).toEqual({ idle: true, cleanup: "daily_cap" });
  });
});

describe("night cleanup — the FRESH answer decides (real batch loop)", () => {
  const html = (code: string, msg: string) =>
    `var searchResults = [{"paymentNo":"${code}","recStore":"","recDate":"","orderAmount":100,"status":1,"statusMessage":"${msg}","shipStatusDetails":[{"notificationName":"${msg}"}],"shipType":"C2C","specialType":null}];`;
  const fetchWith = (answers: Record<string, string>) => vi.fn(async (url: string, opt?: { body?: string }) => {
    if (String(url).includes("/api/Captcha")) return { json: async () => ({ captchaId: "G", image: "x" }) };
    if (!String(url).includes("/PackageDetail")) return { url: SEARCH_URL, text: async () => '<input name="__RequestVerificationToken" type="hidden" value="T">' };
    const codes = new URLSearchParams(String(opt?.body || "")).getAll("PaymentNo[]");
    const parts = codes.map((c) => html(c, answers[c]).replace(/^var searchResults = \[|\];$/g, ""));
    return { url: QUERY_URL, text: async () => `var searchResults = [${parts.join(",")}];` };
  });
  it("still not dropped → leaves Pickup Status; moved → normal update, stays", async () => {
    const sb = fakeSb({ candidates: [cand("a"), cand("b")] });
    const fetchImpl = fetchWith({ Fa99999: ND, Fb99999: "寄件門市已收件" });
    const w = createWorker({
      serviceSb: sb, now: () => NIGHT, logger: logs(), fetchImpl,
      checkRowsImpl: (a: Record<string, unknown>) => checkRows({ ...a, ocr: { solve: async () => "1234", terminate: async () => {} }, limits: { minGapMs: 0, jitterMs: 0, baseBackoffMs: 0 } } as never),
    });
    const out = await w.tick();
    const ups = sb.queries.filter((q) => q.table === "parcel_tracking" && q.op === "update");
    const byId = (id: string) => ups.find((q) => q.filters.some((f) => f[0] === "eq" && f[1] === "id" && f[2] === id))!.patch as Record<string, unknown>;
    expect(byId("a")).toMatchObject({ status: "in_transit", status_message: ND, terminal: true });
    expect(byId("b")).toMatchObject({ status: "in_transit", status_message: "寄件門市已收件", terminal: false });
    expect(out).toMatchObject({ cleanup: "ran", checked: 2, left: 1 });
  });
});
