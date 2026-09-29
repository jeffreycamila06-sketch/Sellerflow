// server/parcelTrackingRunner.js — the impure runner's ORCHESTRATION, tested with
// injected fakes (no tesseract, no network). Pins: explicit user_id scope on the
// service-role select AND update (Miners-bug lesson), batching, the upsert patch
// shape, SET-ONCE arrived_at, unknown-status logging, not_found counting, and the
// daily-cap circuit breaker. The captcha OCR + real HTTP are covered by node --check
// + the on-Render memory probe (tesseract can't run in CI).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  runPoll, capLiveRowsPerSeller, PER_SELLER_LIVE_CAP, pollGateFrom,
  underRequestCap, MAX_REQUESTS_PER_BATCH, DAILY_REQUEST_CAP, taipeiDay,
  nextUnchangedPolls, shouldRetire, RETIRE_AFTER_POLLS,
} from "../../../../server/parcelTrackingRunner.js";
import { QUERY_URL, SEARCH_URL } from "../../../../server/parcelTracking.js";

const HTML_IN_TRANSIT = `var searchResults = [{"paymentNo":"F70334584020","recStore":"朝陽","recDate":"","orderAmount":60,"status":1,"statusMessage":"包裹進行配送中","shipStatusDetails":[{"notificationName":"包裹進行配送中"}],"shipType":"C2C","specialType":null}];`;
const HTML_AT_STORE = `var searchResults = [{"paymentNo":"F11122233344","recStore":"中壢華強","recDate":"2026/09/20","orderAmount":200,"status":1,"statusMessage":"包裹配達取件門市","shipStatusDetails":[{"notificationName":"包裹配達取件門市"}],"shipType":"C2C","specialType":null}];`;
const HTML_UNKNOWN = `var searchResults = [{"paymentNo":"FZ","status":1,"statusMessage":"門市特殊處理中XYZ","shipStatusDetails":[{"notificationName":"門市特殊處理中XYZ"}],"shipType":"C2C","specialType":null}];`;
const HTML_NOT_FOUND = `var searchResults = [{"paymentNo":"FNF","status":0,"statusMessage":"查無資料","shipStatusDetails":[]}];`;
const HTML_EMPTY = `var searchResults = [];`;
const HTML_PICKED_UP = `var searchResults = [{"paymentNo":"FPICK","recStore":"中壢","recDate":"2026/09/15","orderAmount":100,"status":1,"statusMessage":"已完成包裹取件","shipStatusDetails":[{"notificationName":"已完成包裹取件"}],"shipType":"C2C","specialType":null}];`;
const HTML_RETURNED = `var searchResults = [{"paymentNo":"FRET","recStore":"中壢","recDate":"2026/09/15","orderAmount":100,"status":1,"statusMessage":"退貨處理","shipStatusDetails":[{"notificationName":"包裹已送達退貨門市"}],"shipType":"C2C","specialType":null}];`;

// Chainable service-role client fake. Routes by table:
//   app_settings            — the kill switch + cooldown (select().in(); upsert)
//   parcel_tracking_access  — the allowlist (select().eq("enabled", true))
//   parcel_tracking         — paged live select (eq/in/order/range), update, delete
//   parcel_tracking_health  — one insert per run
// Records every select filter, page range, update, delete, health row and upsert.
type Opts = {
  selectError?: unknown; updateError?: unknown; deleteError?: unknown; deleteReturns?: unknown[];
  settings?: Record<string, string>; settingsError?: unknown;
  access?: string[]; accessError?: unknown;
  daily?: Record<string, number>; dailyError?: unknown;
};
function fakeSb(rows: unknown[], opts: Opts = {}) {
  const settings = opts.settings ?? { parcel_tracking_enabled: "true" };
  const access = opts.access ?? ["U"];
  const captured = {
    selectEqs: [] as [string, unknown][],
    selectIns: [] as [string, unknown[]][],
    orders: [] as [string, Record<string, unknown>][],
    ranges: [] as [number, number][],
    updates: [] as { patch: Record<string, unknown>; target: Record<string, unknown> }[],
    deletes: [] as { or: string | null; eqs: Record<string, unknown>; ins: Record<string, unknown[]>; selected: boolean }[],
    health: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    dailyWrites: [] as { day: string; requests: number }[],
    accessReads: 0,
  };
  const daily: Record<string, number> = { ...(opts.daily ?? {}) };
  const thenable = (resolve: () => unknown) => ({
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return Promise.resolve(resolve()).then(onF, onR); },
  });
  const liveSelect = () => {
    const ch: Record<string, unknown> = {
      eq(col: string, val: unknown) { captured.selectEqs.push([col, val]); return ch; },
      in(col: string, vals: unknown[]) { captured.selectIns.push([col, vals]); return ch; },
      order(col: string, o: Record<string, unknown>) { captured.orders.push([col, o]); return ch; },
      range(from: number, to: number) {
        captured.ranges.push([from, to]);
        return thenable(() => ({ data: opts.selectError ? null : (rows as unknown[]).slice(from, to + 1), error: opts.selectError ?? null }));
      },
    };
    return ch;
  };
  const makeUpdate = (patch: Record<string, unknown>) => {
    const target: Record<string, unknown> = {};
    const ch: Record<string, unknown> = {
      eq(col: string, val: unknown) { target[col] = val; return ch; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { captured.updates.push({ patch, target }); return Promise.resolve({ error: opts.updateError ?? null }).then(onF, onR); },
    };
    return ch;
  };
  const makeDelete = () => {
    const rec = { or: null as string | null, eqs: {} as Record<string, unknown>, ins: {} as Record<string, unknown[]>, selected: false };
    const ch: Record<string, unknown> = {
      or(expr: string) { rec.or = expr; return ch; },
      eq(col: string, val: unknown) { rec.eqs[col] = val; return ch; },
      in(col: string, vals: unknown[]) { rec.ins[col] = vals; return ch; },
      select() { rec.selected = true; return ch; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { captured.deletes.push(rec); return Promise.resolve({ data: opts.deleteReturns ?? [], error: opts.deleteError ?? null }).then(onF, onR); },
    };
    return ch;
  };
  return {
    _captured: captured,
    _daily: daily,
    from(table: string) {
      if (table === "app_settings") return {
        select() { return { in: () => thenable(() => ({ data: opts.settingsError ? null : Object.entries(settings).map(([key, value]) => ({ key, value })), error: opts.settingsError ?? null })) }; },
        upsert(row: Record<string, unknown>) { captured.upserts.push(row); settings[String(row.key)] = String(row.value); return thenable(() => ({ error: null })); },
      };
      if (table === "parcel_tracking_access") return {
        select() { return { eq: () => { captured.accessReads += 1; return thenable(() => ({ data: opts.accessError ? null : access.map((user_id) => ({ user_id })), error: opts.accessError ?? null })); } }; },
      };
      if (table === "parcel_tracking_daily") return {
        select() { return { eq: (_c: string, day: string) => ({ maybeSingle: () => thenable(() => ({ data: opts.dailyError ? null : (day in daily ? { requests: daily[day] } : null), error: opts.dailyError ?? null })) }) }; },
        upsert(row: { day: string; requests: number }) { captured.dailyWrites.push({ day: row.day, requests: row.requests }); daily[row.day] = row.requests; return thenable(() => ({ error: null })); },
      };
      if (table === "parcel_tracking_health") return {
        insert(row: Record<string, unknown>) { captured.health.push(row); return thenable(() => ({ error: null })); },
      };
      return { select() { return liveSelect(); }, update(patch: Record<string, unknown>) { return makeUpdate(patch); }, delete() { return makeDelete(); } };
    },
  };
}

// fetch fake: the search page (GET /) returns an antiforgery-token page; captcha
// JSON on /api/Captcha; the given HTML on the /PackageDetail POST (optionally
// expiring the first POST to exercise the captcha-retry path). Only POSTs are
// counted, so the search-page GET never consumes the expired-captcha response.
const TOKEN_PAGE = '<input name="__RequestVerificationToken" type="hidden" value="TESTTOKEN">';
const fetchFactory = (html: string, { expireFirst = false } = {}) => {
  let posts = 0;
  return vi.fn(async (url: string) => {
    if (String(url).includes("/api/Captcha")) return { json: async () => ({ captchaId: "GID", image: "b64png" }) };
    if (!String(url).includes("/PackageDetail")) return { url: SEARCH_URL, text: async () => TOKEN_PAGE }; // GET / (token + cookie)
    posts += 1;
    const expired = expireFirst && posts === 1;
    return { url: expired ? `${QUERY_URL}?handler=expired` : QUERY_URL, text: async () => (expired ? "" : html) };
  });
};
const ocr = () => ({ solve: vi.fn(async () => "1234"), terminate: vi.fn(async () => {}) });
const FIXED_NOW = new Date("2026-09-18T02:00:00Z");
const smallLimits = { minGapMs: 0, jitterMs: 0, baseBackoffMs: 0 };


describe("runPoll — service-role orchestration", () => {
  it("selects terminal=false scoped to the EXPLICIT user_id, and updates by id+user_id", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.selectEqs).toContainEqual(["terminal", false]);
    expect(sb._captured.selectIns).toContainEqual(["user_id", ["U"]]); // override → exactly that user
    expect(sb._captured.accessReads).toBe(0);                          // override skips the allowlist
    expect(sb._captured.updates).toHaveLength(1);
    expect(sb._captured.updates[0].target).toEqual({ id: "r1", user_id: "U" }); // explicit user_id on the write too
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "in_transit", terminal: false, ship_type: "C2C" });
    expect(s).toMatchObject({ ok: true, rows: 1, updated: 1 });
  });

  it("no override → polls exactly the ENABLED allowlist (parcel_tracking_access), still terminal=false", async () => {
    const sb = fakeSb([], { access: ["A", "B"] });
    await runPoll({ serviceSb: sb, userId: null, fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.accessReads).toBe(1);
    expect(sb._captured.selectEqs).toContainEqual(["terminal", false]);
    expect(sb._captured.selectIns).toContainEqual(["user_id", ["A", "B"]]);
  });

  it("arrived_at is SET ONCE: never overwrites an existing value, but fills a null one", async () => {
    // existing arrived_at + at_store result → patch omits arrived_at
    const sbKeep = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F11122233344", arrived_at: "2026-09-17T00:00:00.000Z" }]);
    await runPoll({ serviceSb: sbKeep, userId: "U", fetchImpl: fetchFactory(HTML_AT_STORE), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sbKeep._captured.updates[0].patch).not.toHaveProperty("arrived_at");
    expect(sbKeep._captured.updates[0].patch).toMatchObject({ status: "at_store" });

    // null arrived_at + at_store result → patch sets it to now
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

  it("daily REQUEST cap stops further batches (checked against a batch's worst case)", async () => {
    // 7 codes → 2 batches. Cap = one batch's worst case (7): batch 1 fits (0+7 ≤ 7); it sends
    // 3 requests (GET /, captcha, POST); 3+7 > 7 → batch 2 never starts.
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, user_id: "U", tracking_no: `F${i}0000000`, arrived_at: null }));
    const sb = fakeSb(rows);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: { ...smallLimits, dailyRequestCap: MAX_REQUESTS_PER_BATCH } });
    expect(s.batchesRun).toBe(1);
    expect(s).toMatchObject({ reason: "daily_cap", requests: 3 });
  });

  it("a select error → ok:false, no updates attempted", async () => {
    const sb = fakeSb([], { selectError: { message: "rls/db down" } });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(s).toMatchObject({ ok: false, error: "select_failed" });
    expect(sb._captured.updates).toHaveLength(0);
  });
});

describe("runPoll — 7-day retention (picked_up / returned auto-delete)", () => {
  const CUTOFF = new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 2026-09-11T02:00:00.000Z
// 2026-09-27 retention split: returned rows keep 365 days (repeat no-show evidence).
const CUTOFF_RETURNED = new Date(FIXED_NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

  it("picked_up result → stamps picked_up_at = poll time (terminal)", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FPICK", arrived_at: null }]);
    await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_PICKED_UP), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "picked_up", terminal: true, picked_up_at: FIXED_NOW.toISOString() });
    expect(sb._captured.updates[0].patch).not.toHaveProperty("returned_at");
  });

  it("returned result → stamps returned_at = poll time (terminal)", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FRET", arrived_at: null }]);
    await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_RETURNED), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "returned", terminal: true, returned_at: FIXED_NOW.toISOString() });
    expect(sb._captured.updates[0].patch).not.toHaveProperty("picked_up_at");
  });

  it("issues an owner-scoped DELETE: picked_up older than 7d, returned older than 365d — each status its OWN cutoff", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { deleteReturns: [{ id: "old1" }, { id: "old2" }] });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.deletes).toHaveLength(1);
    const del = sb._captured.deletes[0];
    // OR filter references ONLY the two terminal states + their own timestamp columns
    expect(del.or).toBe(`and(status.eq.picked_up,picked_up_at.lt.${CUTOFF}),and(status.eq.returned,returned_at.lt.${CUTOFF_RETURNED})`);
    expect(del.or).not.toMatch(/in_transit|at_store|created|not_found|unknown/); // NEVER un-claimed rows
    expect(del.eqs).toEqual({ user_id: "U" });   // owner-scoped
    expect(del.selected).toBe(true);             // .select() → counted
    expect(s.purged).toBe(2);
  });

  it("no override → DELETE is scoped to the allowlisted sellers only (never all users)", async () => {
    const sb = fakeSb([], { access: ["A", "B"] });
    await runPoll({ serviceSb: sb, userId: null, fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.deletes).toHaveLength(1);
    expect(sb._captured.deletes[0].eqs).toEqual({});
    expect(sb._captured.deletes[0].ins).toEqual({ user_id: ["A", "B"] });
  });

  it("empty allowlist → no parcel select, no SHOPMORE query, no DELETE", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { access: [] });
    const f = fetchFactory(HTML_IN_TRANSIT);
    const s = await runPoll({ serviceSb: sb, userId: null, fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.ranges).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
    expect(sb._captured.deletes).toHaveLength(0);
    expect(s).toMatchObject({ ok: true, sellers: 0, rows: 0 });
  });

  it("runs the retention DELETE even when there are zero live rows to poll", async () => {
    const sb = fakeSb([]); // nothing to poll
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: smallLimits });
    expect(sb._captured.deletes).toHaveLength(1);
    expect(s.purged).toBe(0);
  });

  it("a delete error is logged but never fails the poll", async () => {
    const err = vi.fn();
    const sb = fakeSb([], { deleteError: { message: "delete blew up" } });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error: err }, limits: smallLimits });
    expect(s.ok).toBe(true);
    expect(err.mock.calls.some((c) => String(c[0]).includes("retention delete failed"))).toBe(true);
  });
});

describe("capLiveRowsPerSeller — per-seller live-row cap (at_store prioritized)", () => {
  it("under the cap → identity (every row kept)", () => {
    const rows = [{ id: "a", user_id: "U", status: "in_transit" }, { id: "b", user_id: "U", status: "at_store" }];
    expect(capLiveRowsPerSeller(rows, 300)).toHaveLength(2);
  });
  it("over the cap → at_store kept first, the rest trimmed", () => {
    const rows = [
      { id: "t1", user_id: "U", status: "in_transit" }, { id: "s1", user_id: "U", status: "at_store" },
      { id: "t2", user_id: "U", status: "in_transit" }, { id: "s2", user_id: "U", status: "at_store" },
    ];
    expect(capLiveRowsPerSeller(rows, 2).map((r) => r.id)).toEqual(["s1", "s2"]); // both at_store survive
  });
  it("caps EACH seller independently", () => {
    const rows = [
      { id: "u1", user_id: "U", status: "in_transit" }, { id: "u2", user_id: "U", status: "in_transit" }, { id: "u3", user_id: "U", status: "at_store" },
      { id: "v1", user_id: "V", status: "in_transit" },
    ];
    const kept = capLiveRowsPerSeller(rows, 2);
    expect(kept.filter((r) => r.user_id === "U")).toHaveLength(2);
    expect(kept.filter((r) => r.user_id === "V")).toHaveLength(1);   // V under cap → all kept
    expect(kept.some((r) => r.id === "u3")).toBe(true);              // U's at_store prioritized in
  });
  it("INERT while owner-scoped: a sub-cap owner set is unchanged; default cap = 300", () => {
    const rows = Array.from({ length: 159 }, (_, i) => ({ id: `r${i}`, user_id: "OWNER", status: "in_transit" }));
    expect(capLiveRowsPerSeller(rows)).toHaveLength(159);
    expect(PER_SELLER_LIVE_CAP).toBe(300);
  });
  it("runPoll wires the cap: over-cap seller → rows trimmed + s.capped reported", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, user_id: "U", tracking_no: `F${i}0000000`, arrived_at: null, status: "in_transit" }));
    const sb = fakeSb(rows);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: { log() {}, warn() {}, error() {} }, limits: { ...smallLimits, perSellerCap: 2 } });
    expect(s.rows).toBe(2);
    expect(s.capped).toBe(2);
  });
});

// ── Stage 1 (sql/60): kill switch, cooldown, paging + ordering, anti-block breaker ──
// POST responses in sequence (one per batch/attempt); GET / and the captcha GET can
// be given a status to simulate a block at those steps.
type Post = { status?: number; url?: string; html: string };
const fetchSeq = (posts: Post[], { pageStatus, captchaStatus }: { pageStatus?: number; captchaStatus?: number } = {}) => {
  let i = 0;
  return vi.fn(async (url: string) => {
    if (String(url).includes("/api/Captcha")) return { status: captchaStatus ?? 200, json: async () => ({ captchaId: "GID", image: "b64png" }) };
    if (!String(url).includes("/PackageDetail")) return { status: pageStatus ?? 200, url: SEARCH_URL, text: async () => TOKEN_PAGE };
    const p = posts[Math.min(i, posts.length - 1)]; i += 1;
    return { status: p.status ?? 200, url: p.url ?? QUERY_URL, text: async () => p.html };
  });
};
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const liveRows = (n: number, user = "U", prefix = "F") =>
  Array.from({ length: n }, (_, k) => ({ id: `${user}${k}`, user_id: user, tracking_no: `${prefix}${user}${String(k).padStart(9, "0")}`, arrived_at: null, status: "in_transit" }));
const htmlFor = (codes: string[]) => `var searchResults = ${JSON.stringify(codes.map((c) => ({ paymentNo: c, status: 1, statusMessage: "包裹進行配送中", shipStatusDetails: [{ notificationName: "包裹進行配送中" }], shipType: "C2C", specialType: null })))};`;

describe("Stage 1 — kill switch + cooldown (read at the start of every run)", () => {
  it("parcel_tracking_enabled='false' → logs [PARCEL-POLL] disabled, touches nothing, writes a health row", async () => {
    const sb = fakeSb(liveRows(3), { settings: { parcel_tracking_enabled: "false" } });
    const f = fetchFactory(HTML_IN_TRANSIT);
    const makeOcr = vi.fn();
    const log = quiet();
    const s = await runPoll({ serviceSb: sb, userId: null, fetchImpl: f, makeOcr, now: () => FIXED_NOW, logger: log, limits: smallLimits });
    expect(s).toMatchObject({ ok: true, skipped: true, reason: "disabled" });
    expect(log.log.mock.calls.some((c) => c[0] === "[PARCEL-POLL] disabled")).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(makeOcr).not.toHaveBeenCalled();          // never loads tesseract for a disabled run
    expect(sb._captured.accessReads).toBe(0);
    expect(sb._captured.ranges).toHaveLength(0);
    expect(sb._captured.deletes).toHaveLength(0);
    expect(sb._captured.health).toHaveLength(1);
    expect(sb._captured.health[0]).toMatchObject({ ok: true, reason: "disabled", queries: 0 });
  });

  it("a MISSING switch row = OFF (opt-in), and a settings read error never runs", async () => {
    const sbMissing = fakeSb(liveRows(1), { settings: {} });
    expect(await runPoll({ serviceSb: sbMissing, fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits })).toMatchObject({ skipped: true, reason: "disabled" });
    const sbErr = fakeSb(liveRows(1), { settingsError: { code: "PGRST" } });
    const f = fetchFactory(HTML_IN_TRANSIT);
    expect(await runPoll({ serviceSb: sbErr, fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits })).toMatchObject({ ok: false, skipped: true, reason: "settings_read_failed" });
    expect(f).not.toHaveBeenCalled();
  });

  it("cooldown in the future → skipped; an expired cooldown → runs", async () => {
    const future = new Date(FIXED_NOW.getTime() + 60_000).toISOString();
    const sb = fakeSb(liveRows(1), { settings: { parcel_tracking_enabled: "true", parcel_tracking_cooldown_until: future } });
    const f = fetchFactory(HTML_IN_TRANSIT);
    expect(await runPoll({ serviceSb: sb, fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits })).toMatchObject({ skipped: true, reason: "cooldown" });
    expect(f).not.toHaveBeenCalled();
    expect(sb._captured.health[0]).toMatchObject({ reason: "cooldown" });

    const past = new Date(FIXED_NOW.getTime() - 60_000).toISOString();
    const sb2 = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { settings: { parcel_tracking_enabled: "true", parcel_tracking_cooldown_until: past } });
    const s2 = await runPoll({ serviceSb: sb2, fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s2).toMatchObject({ ok: true, updated: 1 });
  });

  it("pollGateFrom is exact: only 'true' runs", () => {
    expect(pollGateFrom({ enabled: "true" }, FIXED_NOW).run).toBe(true);
    expect(pollGateFrom({ enabled: " TRUE " }, FIXED_NOW).run).toBe(true);
    for (const v of ["false", "", "1", "yes", undefined, null]) expect(pollGateFrom({ enabled: v as string }, FIXED_NOW).run).toBe(false);
  });
});

describe("Stage 1 — paged, stalest-first selection (never the 1,000-row default)", () => {
  it("pages with .range() until a short page, ordered last_polled_at ASC NULLS FIRST + id", async () => {
    const rows = liveRows(7);
    const sb = fakeSb(rows);
    const s = await runPoll({ serviceSb: sb, fetchImpl: fetchSeq([{ html: htmlFor(rows.map((r) => r.tracking_no)) }]), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: { ...smallLimits, pageSize: 3 } });
    expect(sb._captured.ranges).toEqual([[0, 2], [3, 5], [6, 8]]); // 3 + 3 + 1 (short page stops)
    expect(sb._captured.orders).toContainEqual(["last_polled_at", { ascending: true, nullsFirst: true }]);
    expect(sb._captured.orders).toContainEqual(["id", { ascending: true }]);
    expect(s.rows).toBe(7);                                          // every row, not one page
  });

  it("an exact multiple of the page size still fetches the (empty) next page, then stops", async () => {
    const sb = fakeSb(liveRows(6));
    await runPoll({ serviceSb: sb, fetchImpl: fetchSeq([{ html: HTML_EMPTY }]), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: { ...smallLimits, pageSize: 3 } });
    expect(sb._captured.ranges).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it("the per-seller cap is applied AFTER ordering and keeps the cross-seller interleave (no seller blocks)", () => {
    const ordered = [
      { id: "a1", user_id: "A", status: "in_transit" }, { id: "b1", user_id: "B", status: "in_transit" },
      { id: "a2", user_id: "A", status: "in_transit" }, { id: "b2", user_id: "B", status: "in_transit" },
      { id: "a3", user_id: "A", status: "in_transit" },
    ];
    expect(capLiveRowsPerSeller(ordered, 2).map((r) => r.id)).toEqual(["a1", "b1", "a2", "b2"]); // stalest two each, order kept
  });

  it("a code shared by two sellers is queried ONCE and updates BOTH rows", async () => {
    const rows = [
      { id: "a", user_id: "A", tracking_no: "F70334584020", arrived_at: null },
      { id: "b", user_id: "B", tracking_no: "F70334584020", arrived_at: null },
    ];
    const sb = fakeSb(rows, { access: ["A", "B"] });
    const f = fetchSeq([{ html: HTML_IN_TRANSIT }]);
    const s = await runPoll({ serviceSb: sb, fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s.batchesRun).toBe(1);
    expect(sb._captured.updates.map((u) => u.target)).toEqual([{ id: "a", user_id: "A" }, { id: "b", user_id: "B" }]);
    expect(s.updated).toBe(2);
  });
});

describe("Stage 1 — anti-block: failures are failures, 3 in a row trips the breaker", () => {
  const TRIP_UNTIL = new Date(FIXED_NOW.getTime() + 4 * 60 * 60 * 1000).toISOString();

  it("HTTP 403 on the query POST, 3 batches in a row → run aborted, 4h cooldown stored, loud log, health ok=false", async () => {
    const rows = liveRows(30); // 5 batches of 6
    const sb = fakeSb(rows);
    const log = quiet();
    const s = await runPoll({ serviceSb: sb, fetchImpl: fetchSeq([{ status: 403, html: "<html>Forbidden</html>" }]), ocr: ocr(), now: () => FIXED_NOW, logger: log, limits: smallLimits });
    expect(s).toMatchObject({ ok: false, tripped: true, reason: "circuit_open", batchesRun: 3, failures: 3, updated: 0 });
    expect(sb._captured.upserts).toEqual([expect.objectContaining({ key: "parcel_tracking_cooldown_until", value: TRIP_UNTIL })]);
    expect(log.error.mock.calls.some((c) => String(c[0]).includes("CIRCUIT OPEN"))).toBe(true);
    expect(sb._captured.health[0]).toMatchObject({ ok: false, reason: "circuit_open", queries: 3, errors: 3 });
    // failed batches only stamp the ATTEMPT (rotation) — no status field is ever written
    for (const u of sb._captured.updates) expect(Object.keys(u.patch)).toEqual(["last_polled_at"]);
    expect(sb._captured.updates).toHaveLength(18); // 3 batches × 6 rows
  });

  it("each block shape counts as a failure: page GET 403, captcha 429, error redirect, no searchResults, empty []", async () => {
    const cases: [string, ReturnType<typeof fetchSeq>][] = [
      ["page_http_403", fetchSeq([{ html: HTML_IN_TRANSIT }], { pageStatus: 403 })],
      ["captcha_http_429", fetchSeq([{ html: HTML_IN_TRANSIT }], { captchaStatus: 429 })],
      ["error_redirect", fetchSeq([{ url: "https://tracking.shopmore.com.tw/Error", html: "<html>oops</html>" }])],
      ["no_results", fetchSeq([{ html: "<html>Service unavailable</html>" }])],
      ["empty_results", fetchSeq([{ html: HTML_EMPTY }])],
    ];
    for (const [reason, f] of cases) {
        const sb = fakeSb(liveRows(1));
      const log = quiet();
      const s = await runPoll({ serviceSb: sb, fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: log, limits: smallLimits });
      expect(s.failures, reason).toBe(1);
      expect(s.updated, reason).toBe(0);
      expect(log.warn.mock.calls.some((c) => String(c[0]).includes(`batch failed: ${reason}`)), reason).toBe(true);
    }
  });

  it("a non-2xx POST is a failure EVEN IF its body looks like real results (status wins over body)", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const log = quiet();
    const s = await runPoll({ serviceSb: sb, fetchImpl: fetchSeq([{ status: 503, html: HTML_IN_TRANSIT }]), ocr: ocr(), now: () => FIXED_NOW, logger: log, limits: smallLimits });
    expect(s).toMatchObject({ failures: 1, updated: 0 });
    expect(log.warn.mock.calls.some((c) => String(c[0]).includes("batch failed: http_503"))).toBe(true);
  });

  it("a success resets the streak: fail, fail, OK, fail, fail → NOT tripped", async () => {
    const rows = liveRows(30);
    const ok = { html: htmlFor(rows.slice(12, 18).map((r) => r.tracking_no)) };
    const bad = { status: 500, html: "err" };
    const sb = fakeSb(rows);
    const s = await runPoll({ serviceSb: sb, fetchImpl: fetchSeq([bad, bad, ok, bad, bad]), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s).toMatchObject({ ok: true, tripped: false, batchesRun: 5, failures: 4, updated: 6 });
    expect(sb._captured.upserts).toHaveLength(0);
  });

  it("makeOcr: the worker is created only when a batch is sent, and ALWAYS terminated", async () => {
    const worker = ocr();
    const makeOcr = vi.fn(async () => worker);
    await runPoll({ serviceSb: fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]), fetchImpl: fetchFactory(HTML_IN_TRANSIT), makeOcr, now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(makeOcr).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const makeNone = vi.fn();
    await runPoll({ serviceSb: fakeSb([]), fetchImpl: fetchFactory(HTML_EMPTY), makeOcr: makeNone, now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(makeNone).not.toHaveBeenCalled(); // nothing to poll → no tesseract
  });
});

describe("Stage 1 — logs are COUNT-ONLY (no codes, messages, HTML)", () => {
  it("update failures log the DB error CODE, never the message (which can echo key values)", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { updateError: { code: "23505", message: "Key (user_id, tracking_no)=(U, F70334584020) already exists" } });
    const log = quiet();
    await runPoll({ serviceSb: sb, fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: log, limits: smallLimits });
    const all = [...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().map(String).join("\n");
    expect(log.error.mock.calls).toContainEqual(["[PARCEL-POLL] update failed", "r1", "23505"]);
    expect(all).not.toContain("F70334584020");
    expect(all).not.toContain("already exists");
  });

  it("across success, failure and breaker paths, no tracking code or response HTML reaches the logs", async () => {
    const rows = liveRows(30);
    const log = quiet();
    await runPoll({ serviceSb: fakeSb(rows), fetchImpl: fetchSeq([{ html: htmlFor(rows.slice(0, 6).map((r) => r.tracking_no)) }, { status: 403, html: "<html>blocked BODYMARK</html>" }]), ocr: ocr(), now: () => FIXED_NOW, logger: log, limits: smallLimits });
    const all = [...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().map(String).join("\n");
    for (const r of rows) expect(all).not.toContain(r.tracking_no);
    expect(all).not.toContain("BODYMARK");
  });
});

// ── Stage 1b (sql/61) ──────────────────────────────────────────────────────────
describe("Stage 1b — S2: the daily REQUEST cap is persisted per Taipei day", () => {
  const TODAY = taipeiDay(FIXED_NOW); // FIXED_NOW = 2026-09-18T02:00Z → 2026-09-18 Taipei

  it("counts every HTTP request (not batches) and writes the running total to parcel_tracking_daily", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s.requests).toBe(3);                                   // GET / + captcha + POST
    expect(sb._daily[TODAY]).toBe(3);
    expect(sb._captured.dailyWrites.at(-1)).toEqual({ day: TODAY, requests: 3 });
    expect(sb._captured.health[0]).toMatchObject({ requests: 3 });
  });

  it("a captcha retry counts its extra captcha GET + POST", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT, { expireFirst: true }), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s.requests).toBe(5);                                   // GET / + 2×(captcha + POST)
  });

  it("SURVIVES A RESTART: a new run starts from the stored count, and stops at the cap", async () => {
    const cap = 100;
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, user_id: "U", tracking_no: `F${i}0000000`, arrived_at: null }));
    // a previous process already spent 95 today → 95 + 7 > 100 → not a single batch
    const sb = fakeSb(rows, { daily: { [TODAY]: 95 } });
    const f = fetchFactory(HTML_EMPTY);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: { ...smallLimits, dailyRequestCap: cap } });
    expect(s).toMatchObject({ batchesRun: 0, reason: "daily_cap", requests: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it("resets at 00:00 Asia/Taipei: yesterday's count does not block today", async () => {
    const yesterday = taipeiDay(new Date(FIXED_NOW.getTime() - 24 * 3600 * 1000));
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { daily: { [yesterday]: 99999 } });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_IN_TRANSIT), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s).toMatchObject({ updated: 1, requestsToday: 3 });
    expect(sb._daily[yesterday]).toBe(99999);                     // untouched
  });

  it("the Taipei day key flips at 16:00 UTC (= 00:00 Taipei)", () => {
    expect(taipeiDay(new Date("2026-09-18T15:59:59Z"))).toBe("2026-09-18");
    expect(taipeiDay(new Date("2026-09-18T16:00:00Z"))).toBe("2026-09-19");
  });

  it("an unreadable counter → the run does not start (never polls blind)", async () => {
    const f = fetchFactory(HTML_IN_TRANSIT);
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F70334584020", arrived_at: null }], { dailyError: { code: "PGRST" } });
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: f, ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(s).toMatchObject({ ok: false, reason: "daily_read_failed" });
    expect(f).not.toHaveBeenCalled();
  });

  it("underRequestCap reserves a batch's worst case; default cap is 4,500 requests", () => {
    expect(MAX_REQUESTS_PER_BATCH).toBe(7);
    expect(underRequestCap(0, 7)).toBe(true);
    expect(underRequestCap(1, 7)).toBe(false);
    expect(DAILY_REQUEST_CAP).toBe(4500);
    expect(underRequestCap(4493)).toBe(true);
    expect(underRequestCap(4494)).toBe(false);
  });
});

describe("Stage 1b — S8: retire not_found / unknown rows that never resolve", () => {
  const OLD = new Date(FIXED_NOW.getTime() - 15 * 24 * 3600 * 1000).toISOString(); // 15 days old
  const NEW = new Date(FIXED_NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString();  // 3 days old

  it("nextUnchangedPolls counts consecutive same-status polls and resets on any change", () => {
    expect(nextUnchangedPolls("not_found", "not_found", 3)).toBe(4);
    expect(nextUnchangedPolls("created", "not_found", 0)).toBe(0);
    expect(nextUnchangedPolls("not_found", "at_store", 9)).toBe(0);
    expect(nextUnchangedPolls("unknown", "unknown", undefined)).toBe(1);
  });

  it("shouldRetire: not_found/unknown only, 5+ unchanged polls AND 14+ days old", () => {
    const now = FIXED_NOW;
    expect(shouldRetire({ status: "not_found", unchangedPolls: RETIRE_AFTER_POLLS, createdAt: OLD, now })).toBe(true);
    expect(shouldRetire({ status: "unknown", unchangedPolls: 7, createdAt: OLD, now })).toBe(true);
    expect(shouldRetire({ status: "not_found", unchangedPolls: 4, createdAt: OLD, now })).toBe(false);  // not enough polls
    expect(shouldRetire({ status: "not_found", unchangedPolls: 9, createdAt: NEW, now })).toBe(false);  // too young
    for (const st of ["in_transit", "at_store", "created"]) expect(shouldRetire({ status: st, unchangedPolls: 99, createdAt: OLD, now }), st).toBe(false);
    expect(shouldRetire({ status: "not_found", unchangedPolls: 9, createdAt: null, now })).toBe(false);  // unknown age → keep
  });

  it("the 5th unchanged not_found poll on an old row sets terminal=true, keeps the status, counts it in health", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FNF", arrived_at: null, status: "not_found", unchanged_polls: 4, created_at: OLD }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_NOT_FOUND), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "not_found", terminal: true, unchanged_polls: 5 });
    expect(s.retired).toBe(1);
    expect(sb._captured.health[0]).toMatchObject({ retired: 1 });
  });

  it("a young not_found row keeps being polled (terminal stays false) while its counter climbs", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "FNF", arrived_at: null, status: "not_found", unchanged_polls: 8, created_at: NEW }]);
    const s = await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_NOT_FOUND), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "not_found", terminal: false, unchanged_polls: 9 });
    expect(s.retired).toBe(0);
  });

  it("a status change resets the counter (a parcel that finally resolves is never retired)", async () => {
    const sb = fakeSb([{ id: "r1", user_id: "U", tracking_no: "F11122233344", arrived_at: null, status: "not_found", unchanged_polls: 9, created_at: OLD }]);
    await runPoll({ serviceSb: sb, userId: "U", fetchImpl: fetchFactory(HTML_AT_STORE), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(sb._captured.updates[0].patch).toMatchObject({ status: "at_store", terminal: false, unchanged_polls: 0 });
  });

  it("the poll select reads the counter + age it needs", async () => {
    const src = readFileSync("server/parcelTrackingRunner.js", "utf8");
    expect(src).toContain('.select("id,user_id,tracking_no,arrived_at,status,unchanged_polls,created_at")');
  });
});

describe("Stage 1b — health row: sellers polled + rows skipped by the per-seller cap", () => {
  it("writes sellers (distinct allowlisted user_ids) and skipped_cap", async () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, user_id: "A", tracking_no: `FA${i}000000`, arrived_at: null, status: "in_transit" })),
      { id: "b0", user_id: "B", tracking_no: "FB0000000", arrived_at: null, status: "in_transit" },
    ];
    const sb = fakeSb(rows, { access: ["A", "B"] });
    await runPoll({ serviceSb: sb, fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: { ...smallLimits, perSellerCap: 2 } });
    expect(sb._captured.health[0]).toMatchObject({ sellers: 2, skipped_cap: 2 });
  });
  it("sellers counts sellers actually polled — an allowlisted seller with no live rows is not counted", async () => {
    const sb = fakeSb([{ id: "a0", user_id: "A", tracking_no: "FA0000000", arrived_at: null, status: "in_transit" }], { access: ["A", "B", "C"] });
    await runPoll({ serviceSb: sb, fetchImpl: fetchFactory(HTML_EMPTY), ocr: ocr(), now: () => FIXED_NOW, logger: quiet(), limits: smallLimits });
    expect(sb._captured.health[0]).toMatchObject({ sellers: 1 });
  });
});
