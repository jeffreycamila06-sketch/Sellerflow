// server/parcelTrackingRunner.js — the impure runner's ORCHESTRATION, tested with
// injected fakes (no tesseract, no network). Pins: explicit user_id scope on the
// service-role select AND update (Miners-bug lesson), batching, the upsert patch
// shape, SET-ONCE arrived_at, unknown-status logging, not_found counting, and the
// daily-cap circuit breaker. The captcha OCR + real HTTP are covered by node --check
// + the on-Render memory probe (tesseract can't run in CI).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPoll, __resetDailyCounter } from "../../../../server/parcelTrackingRunner.js";
import { QUERY_URL } from "../../../../server/parcelTracking.js";

const HTML_IN_TRANSIT = `var searchResults = [{"paymentNo":"F70334584020","recStore":"朝陽","recDate":"","orderAmount":60,"status":1,"statusMessage":"包裹進行配送中","shipStatusDetails":[{"notificationName":"包裹進行配送中"}],"shipType":"C2C","specialType":null}];`;
const HTML_AT_STORE = `var searchResults = [{"paymentNo":"F11122233344","recStore":"中壢華強","recDate":"2026/09/20","orderAmount":200,"status":1,"statusMessage":"包裹配達取件門市","shipStatusDetails":[{"notificationName":"包裹配達取件門市"}],"shipType":"C2C","specialType":null}];`;
const HTML_UNKNOWN = `var searchResults = [{"paymentNo":"FZ","status":1,"statusMessage":"門市特殊處理中XYZ","shipStatusDetails":[{"notificationName":"門市特殊處理中XYZ"}],"shipType":"C2C","specialType":null}];`;
const HTML_NOT_FOUND = `var searchResults = [{"paymentNo":"FNF","status":0,"statusMessage":"查無資料","shipStatusDetails":[]}];`;
const HTML_EMPTY = `var searchResults = [];`;

// Chainable service-role client fake — records select .eq() scope + every update.
function fakeSb(rows: unknown[], opts: { selectError?: unknown; updateError?: unknown } = {}) {
  const captured = { selectEqs: [] as [string, unknown][], updates: [] as { patch: Record<string, unknown>; target: Record<string, unknown> }[] };
  const selectChain: Record<string, unknown> = {
    eq(col: string, val: unknown) { captured.selectEqs.push([col, val]); return selectChain; },
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return Promise.resolve({ data: rows, error: opts.selectError ?? null }).then(onF, onR); },
  };
  const makeUpdate = (patch: Record<string, unknown>) => {
    const target: Record<string, unknown> = {};
    const ch: Record<string, unknown> = {
      eq(col: string, val: unknown) { target[col] = val; return ch; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { captured.updates.push({ patch, target }); return Promise.resolve({ error: opts.updateError ?? null }).then(onF, onR); },
    };
    return ch;
  };
  return {
    _captured: captured,
    from() { return { select() { return selectChain; }, update(patch: Record<string, unknown>) { return makeUpdate(patch); } }; },
  };
}

// fetch fake: captcha JSON on /api/Captcha, the given HTML on POST (optionally
// expiring the first POST to exercise the captcha-retry path).
const fetchFactory = (html: string, { expireFirst = false } = {}) => {
  let posts = 0;
  return vi.fn(async (url: string) => {
    if (String(url).includes("/api/Captcha")) return { json: async () => ({ captchaId: "GID", image: "b64png" }) };
    posts += 1;
    const expired = expireFirst && posts === 1;
    return { url: expired ? `${QUERY_URL}?handler=expired` : QUERY_URL, text: async () => (expired ? "" : html) };
  });
};
const ocr = () => ({ solve: vi.fn(async () => "1234"), terminate: vi.fn(async () => {}) });
const FIXED_NOW = new Date("2026-09-18T02:00:00Z");
const smallLimits = { minGapMs: 0, jitterMs: 0, baseBackoffMs: 0 };

beforeEach(() => __resetDailyCounter());

describe("runPoll — service-role orchestration", () => {
  it("selects terminal=false scoped to the EXPLICIT user_id, and updates by id+user_id", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.selectEqs).toContainEqual(["terminal", false]);
    expect(sb._captured.selectEqs).toContainEqual(["user_id", "U"]);
    expect(sb._captured.updates).toHaveLength(1);
    expect(sb._captured.updates[0].target).toEqual({ id: "r1", user_id: "U" }); // explicit user_id on the write too
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "in_transit", terminal: false, ship_type: "C2C" });
    expect(s).toMatchObject({ ok: true, rows: 1, updated: 1 });
  });

  it("Phase 2: userId null → NO user_id filter on the select (still terminal=false)", async () => {
    const sb = fakeSb([]);
    await runPoll({ serviceSb: sb, userId: null, fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.selectEqs).toContainEqual(["terminal", false]);
    expect(sb._captured.selectEqs.find((e) => e[0] === "user_id")).toBeUndefined();
  });

  it("arrived_at is SET ONCE: never overwrites an existing value, but fills a null one", async () => {
    // existing arrived_at + at_store result → patch omits arrived_at
    const sbKeep = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F11122233344", arrived_at: "2026-09-17T00:00:00.000Z" }]);
    await runPoll({ serviceSb: sbKeep, userId: "U", fetchImpl: fetchFactory(HTML_AT_STORE), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sbKeep._captured.updates[0].patch).not.toHaveProperty("arrived_at");
    expect(sbKeep._captured.updates[0].patch).toMatchObject({ status: "at_store" });

    // null arrived_at + at_store result → patch sets it to now
    __resetDailyCounter();
    const sbFill = fakeSb([{ id: "r2", user_id: "U", tracking_no: "F11122233344", arrived_at: null }]);
    await runPoll({ serviceSb: sbFill, userId: "U", fetchImpl: fetchFactory(HTML_AT_STORE), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sbFill._captured.updates[0].patch.arrived_at).toBe(FIXED_NOW.toISOString());
  });

  it("logs every unknown statusMessage + counts it", async () => {
    const warn = vi.fn();
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FZ", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_UNKNOWN), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn, error() {} }, limits: smallLimits });
    expect(s.unknowns).toBe(1);
    expect(sb._captured.updates[0].patch.status).toBe("unknown");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("UNKNOWN"))).toBe(true);
  });

  it("status 0/2 → not_found, counted", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FNF", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_NOT_FOUND), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.updates[0].patch.status).toBe("not_found");
    expect(s.notFound).toBe(1);
  });

  it("expired captcha → refetches + retries within the batch, still upserts", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const fetchImpl = fetchFactory(HTML_IN_TRANSIT, { expireFirst: true });
    const o = ocr();
    await runPoll({ serviceSb: sb, userId: "U", fetchImpl, ocr: o, now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(o.solve).toHaveBeenCalledTimes(2); // solved twice (first captcha rejected)
    expect(sb._captured.updates[0].patch.status).toBe("in_transit");
  });

  it("daily-cap circuit breaker stops further batches", async () => {
    // 7 codes → 2 batches; dailyCap=1 → only the first batch runs.
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, user_id: "U", tracking_no: `F${i}0000000`, arrived_at: null }));
    const sb = fakeSb(rows);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: { ...smallLimits, dailyCap: 1 } });
    expect(s.batchesRun).toBe(1);
  });

  it("a select error → ok:false, no updates attempted", async () => {
    const sb = fakeSb([], { selectError: { message: "rls/db down" } });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(s).toMatchObject({ ok: false, error: "select_failed" });
    expect(sb._captured.updates).toHaveLength(0);
  });
});
