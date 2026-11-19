// 2026-11-19 — FamilyMart (全家) parcels the FamilyMart site has NOTHING for yet (branch
// claude/fm-pickup-accuracy-2, sql/185).
//   A. A seller's press (job kind "manual") asks EVERY unfinished 全家 parcel: no 24-hour skip.
//      Order: at a store first (nearest deadline first), then the rest, least recently checked first.
//   B. The check saves what the site said (parcel_tracking.fm_site_state): "not_found" (the site does
//      not know the number) or "not_dropped" (it knows the order, never handed in). The parcel leaves
//      Pickup Status on the answer JUST RECEIVED when it was saved 10+ Taipei days ago, or when the site
//      does not know the number and the file's drop-off date has passed. Any real answer clears it.
//      While sql/185 is not applied the check writes exactly what it wrote before.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fmNothingYet, fmRowChange, classifyFm, FM_SITE_STATE, FM_LEAVE_AFTER_DAYS, FM_CODES } from "../../../../server/fmTracking.js";
import { checkFmRows, runFmPlan, selectFmRows, fmStateColumnMissing, FM_PARCELS_PER_JOB } from "../../../../server/fmTrackingRunner.js";
import { fmScopeForJob, scopeForJob, IN_TRANSIT_FRESH_MS } from "../../../../server/parcelTrackingWorker.js";
import { orderForCheck, RETIRE_NOT_DROPPED_DAYS } from "../../../../server/pickupRules.js";

const NOW = new Date("2026-11-19T03:00:00.000Z"); // 11:00 Taipei, Thursday 19 November
const NOW_ISO = NOW.toISOString();
const U1 = "user-1";
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

// ── the rule (pure) ────────────────────────────────────────────────────────────
const open = (o: Record<string, unknown> = {}) => ({
  status: "in_transit", fm_answered_at: null, created_at: "2026-11-15T02:00:00.000Z", pickup_deadline: null, ...o,
});

describe("fmNothingYet — what a 'nothing yet' answer just received means for the row", () => {
  it("saves the fact: not_found → 'not_found', not_shipped → 'not_dropped' (the two words the database allows)", () => {
    expect(fmNothingYet("not_found", open(), NOW)).toEqual({ state: "not_found", leaves: false, why: null });
    expect(fmNothingYet("not_shipped", open(), NOW)).toEqual({ state: "not_dropped", leaves: false, why: null });
    expect(Object.values(FM_SITE_STATE).sort()).toEqual(["not_dropped", "not_found"]);
  });
  it("leaves at 10 Taipei calendar days after the save, not one day sooner — for both answers", () => {
    expect(FM_LEAVE_AFTER_DAYS).toBe(10);
    expect(FM_LEAVE_AFTER_DAYS).toBe(RETIRE_NOT_DROPPED_DAYS); // the 7-11 number
    // saved 2026-11-10 00:00 Taipei → 9 days → stays
    for (const kind of ["not_found", "not_shipped"]) {
      expect(fmNothingYet(kind, open({ created_at: "2026-11-09T16:00:00.000Z" }), NOW)?.leaves, kind).toBe(false);
      // saved 2026-11-09 23:59 Taipei → 10 days → leaves
      expect(fmNothingYet(kind, open({ created_at: "2026-11-09T15:59:00.000Z" }), NOW), kind).toMatchObject({ leaves: true, why: "days" });
      expect(fmNothingYet(kind, open({ created_at: "2026-10-01T00:00:00.000Z" }), NOW), kind).toMatchObject({ leaves: true, why: "days" });
    }
  });
  it("the site does not know the number AND the drop-off date has passed → leaves now", () => {
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-18" }), NOW)).toEqual({ state: "not_found", leaves: true, why: "date" });
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-18T00:00:00+00:00" }), NOW)?.why).toBe("date");
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-19" }), NOW)?.leaves).toBe(false); // today: not passed
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-25" }), NOW)?.leaves).toBe(false);
    expect(fmNothingYet("not_found", open({ pickup_deadline: "soon" }), NOW)?.leaves).toBe(false);
  });
  it("the site knows the order (not handed in) and the date has passed → stays (FamilyMart's own void step removes such orders)", () => {
    expect(fmNothingYet("not_shipped", open({ pickup_deadline: "2026-11-18" }), NOW)).toEqual({ state: "not_dropped", leaves: false, why: null });
  });
  it("the drop-off date is read on the Taipei day: 23:59 Taipei of the date is still 'not passed'", () => {
    const lateNight = new Date("2026-11-18T15:59:00.000Z"); // 18 Nov 23:59 Taipei
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-18" }), lateNight)?.leaves).toBe(false);
    const nextMorning = new Date("2026-11-18T16:00:00.000Z"); // 19 Nov 00:00 Taipei
    expect(fmNothingYet("not_found", open({ pickup_deadline: "2026-11-18" }), nextMorning)?.leaves).toBe(true);
  });
  it("no readable saved time → the 10-day rule cannot decide (the date rule still can)", () => {
    expect(fmNothingYet("not_found", open({ created_at: null }), NOW)).toEqual({ state: "not_found", leaves: false, why: null });
    expect(fmNothingYet("not_found", open({ created_at: "garbage", pickup_deadline: "2026-11-01" }), NOW)?.why).toBe("date");
  });
  it("never for a row the site has really answered once, a row that is not in transit, another answer, or no row", () => {
    expect(fmNothingYet("not_found", open({ fm_answered_at: "2026-11-16T00:00:00.000Z" }), NOW)).toBeNull();
    for (const status of ["at_store", "created", "picked_up", "returned", null]) expect(fmNothingYet("not_found", open({ status }), NOW), String(status)).toBeNull();
    for (const kind of ["at_store", "in_transit", "picked_up", "returned", "unknown", "void_unclear", "expired", "", "constructor", "__proto__"]) {
      expect(fmNothingYet(kind, open({ created_at: "2026-10-01T00:00:00.000Z" }), NOW), kind).toBeNull();
    }
    expect(fmNothingYet("not_found", null, NOW)).toBeNull();
  });
});

describe("fmRowChange — what is written, and the write of before (plain)", () => {
  const row = { arrived_at: null, rec_store: null, ...open() };
  it("a real answer clears the saved fact; plain = exactly the write of before", () => {
    const steps = [{ ORDER_NO: "16300000001", EC_ORDER_NO: "16300000001", ORDER_STATUS: "08", ORDER_DATE: "2026/11/18", ORDER_TIME: "10:00", STATUS_D: FM_CODES["08"], RCV_STORE_NAME: "取件店", ORDER_DATE_RTN: "2026/11/25" }];
    const c = fmRowChange(classifyFm(steps, "16300000001"), row, NOW_ISO) as { patch: Record<string, unknown>; plain: Record<string, unknown> };
    expect(c.patch.fm_site_state).toBeNull();
    expect("fm_site_state" in c.plain).toBe(false);
    const { fm_site_state: _gone, ...rest } = c.patch;
    expect(rest).toEqual(c.plain);
    expect(c.plain).toMatchObject({ status: "at_store", fm_answered_at: NOW_ISO, last_polled_at: NOW_ISO });
  });
  it("'nothing yet' that stays → the fact and the check time; nothing else", () => {
    expect(fmRowChange({ kind: "not_found" }, row, NOW_ISO)).toEqual({
      action: "update", patch: { last_polled_at: NOW_ISO, fm_site_state: "not_found" }, plain: { last_polled_at: NOW_ISO },
      site: { state: "not_found", leaves: false, why: null },
    });
    expect((fmRowChange({ kind: "not_shipped" }, row, NOW_ISO) as { patch: unknown }).patch).toEqual({ last_polled_at: NOW_ISO, fm_site_state: "not_dropped" });
  });
  it("'nothing yet' that leaves → finished, status and message untouched; plain never finishes the row", () => {
    const c = fmRowChange({ kind: "not_found" }, { ...row, created_at: "2026-11-01T00:00:00.000Z" }, NOW_ISO) as { patch: Record<string, unknown>; plain: Record<string, unknown> };
    expect(c.patch).toEqual({ last_polled_at: NOW_ISO, fm_site_state: "not_found", terminal: true });
    expect(c.plain).toEqual({ last_polled_at: NOW_ISO });
    for (const k of ["status", "status_message", "fm_answered_at", "pickup_deadline", "tracking_no"]) expect(k in c.patch, k).toBe(false);
  });
  it("a row already answered once → the check time only, as before (no fact)", () => {
    const c = fmRowChange({ kind: "not_found" }, { ...row, fm_answered_at: "2026-11-17T00:00:00.000Z" }, NOW_ISO) as { patch: unknown; plain: unknown };
    expect(c.patch).toEqual({ last_polled_at: NOW_ISO });
    expect(c.patch).toBe(c.plain);
  });
  it("an unknown code / a void order with other steps → the check time, and the fact is cleared (the site said something)", () => {
    for (const kind of ["unknown", "void_unclear"]) {
      expect(fmRowChange({ kind }, row, NOW_ISO), kind).toEqual({ action: "update", patch: { last_polled_at: NOW_ISO, fm_site_state: null }, plain: { last_polled_at: NOW_ISO } });
    }
  });
  it("a void order is still removed (unchanged)", () => {
    expect(fmRowChange({ kind: "expired" }, row, NOW_ISO)).toEqual({ action: "delete" });
  });
});

// ── the check against a fake database (the session is a stand-in: no site, no captcha) ──────────
type Row = Record<string, unknown>;
type DbOpts = { rows: Row[]; noColumn?: boolean; writeError?: string };
function fakeDb(o: DbOpts) {
  const rows = o.rows.map((r) => ({ ...r }));
  const writes: { op: string; patch: Row | null; eqs: [string, unknown][] }[] = [];
  const health: Row[] = [];
  const missing = { code: "PGRST204", message: "Could not find the 'fm_site_state' column of 'parcel_tracking' in the schema cache" };
  const from = (table: string) => {
    const q = { op: "select", patch: null as Row | null, eqs: [] as [string, unknown][], cols: null as string[] | null };
    const resolve = () => {
      if (table === "parcel_tracking_health") {
        if (o.noColumn && q.patch && "fm_not_found" in q.patch) return { data: null, error: { code: "PGRST204", message: "Could not find the 'fm_left' column of 'parcel_tracking_health' in the schema cache" } };
        health.push({ ...(q.patch as Row) });
        return { data: null, error: null };
      }
      if (table !== "parcel_tracking") return { data: null, error: null }; // fm_tracking_daily, app_settings
      if (q.op === "select" && q.cols) { // a read: only the columns asked for (as PostgREST does)
        const cols = q.cols;
        return { data: rows.filter((r) => q.eqs.every(([c, v]) => r[c] === v)).map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]))), error: null };
      }
      writes.push({ op: q.op, patch: q.patch, eqs: q.eqs });
      if (o.writeError) return { data: null, error: { code: o.writeError, message: "statement timeout" } };
      if (o.noColumn && q.patch && "fm_site_state" in q.patch) return { data: null, error: missing };
      const hit = rows.filter((r) => q.eqs.every(([c, v]) => r[c] === v));
      if (q.op === "update") for (const r of hit) Object.assign(r, q.patch);
      if (q.op === "delete") for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    };
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(f, r);
        return (...a: unknown[]) => {
          if (k === "update" || k === "insert" || k === "upsert" || k === "delete") { q.op = k; q.patch = (a[0] as Row) ?? null; }
          if (k === "eq") q.eqs.push([a[0] as string, a[1]]);
          if (k === "select" && q.op === "select") q.cols = String(a[0] ?? "").split(",").map((c) => c.trim());
          return ch;
        };
      },
    });
    return ch;
  };
  return { from, rpc: async () => ({ data: null, error: null }), rows, writes: () => writes.filter((w) => w.op !== "select"), health };
}
const T_FOUND = "16300000101", T_NONE = "16300000102", T_01 = "16300000103", T_OLD = "16300000104", T_DATE = "16300000105", T_ANS = "16300000106";
const step = (no: string, code: string, date = "2026/11/18") => ({ ORDER_NO: no, EC_ORDER_NO: no, ORDER_STATUS: code, ORDER_DATE: date, ORDER_TIME: "09:00", STATUS_D: (FM_CODES as Record<string, string>)[code], RCV_STORE_NAME: "取件店", ORDER_DATE_RTN: "2026/11/26" });
// what the site says for each parcel
const SAYS: Record<string, unknown> = {
  [T_FOUND]: classifyFm([step(T_FOUND, "08"), step(T_FOUND, "02", "2026/11/16"), step(T_FOUND, "01", "2026/11/15")], T_FOUND),
  [T_NONE]: { kind: "not_found" },
  [T_01]: classifyFm([step(T_01, "01", "2026/11/15")], T_01),
  [T_OLD]: { kind: "not_found" },
  [T_DATE]: { kind: "not_found" },
  [T_ANS]: { kind: "not_found" },
};
const fakeSession = vi.fn(async (codes: string[]) => ({ results: codes.map((c) => ({ tracking_no: c, result: SAYS[c] })), captchaTries: 1, captchaHits: 1 }));
const mk = (id: string, tracking_no: string, o: Row = {}): Row => ({
  id, user_id: U1, carrier: "fm", tracking_no, status: "in_transit", terminal: false, arrived_at: null, rec_store: null,
  created_at: "2026-11-15T02:00:00.000Z", last_polled_at: null, pickup_deadline: null, fm_answered_at: null, fm_site_state: null, ...o,
});
const ROWS = () => [
  mk("found", T_FOUND, { fm_site_state: "not_found" }),                    // the site answers now → the fact is cleared
  mk("none", T_NONE),                                                      // unknown number, saved 4 days ago → stays, "not_found"
  mk("o1", T_01),                                                          // only step 01 → stays, "not_dropped"
  mk("old", T_OLD, { created_at: "2026-11-05T00:00:00.000Z" }),            // unknown number, saved 14 days ago → leaves
  mk("date", T_DATE, { pickup_deadline: "2026-11-17" }),                   // unknown number, drop-off date passed → leaves
  mk("ans", T_ANS, { fm_answered_at: "2026-11-17T00:00:00.000Z" }),        // answered once before → check time only
];
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const lines = (l: ReturnType<typeof quiet>) => [...l.log.mock.calls, ...l.warn.mock.calls, ...l.error.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
const FAST = { requestGapMs: 0, requestJitterMs: 0, sessionGapMs: 0, sessionJitterMs: 0, baseBackoffMs: 0, maxBackoffMs: 0 };
const check = (db: ReturnType<typeof fakeDb>, logger = quiet()) => checkFmRows({
  serviceSb: db, rows: db.rows, userId: U1, daily: { day: "2026-11-19", requests: 0, captchaTries: 0, captchaHits: 0, parcels: 0 },
  ocr: { solve: async () => "", dead: false }, sessionImpl: fakeSession as never, now: () => NOW, logger: logger as unknown as Console, limits: FAST,
}).then((stats: Record<string, unknown>) => ({ stats, logger }));
const by = (db: ReturnType<typeof fakeDb>) => Object.fromEntries(db.rows.map((r) => [r.id, r]));

describe("the check writes the fact (sql/185 applied)", () => {
  it("each parcel: the fact saved, cleared, left — and the counts", async () => {
    const db = fakeDb({ rows: ROWS() });
    const { stats } = await check(db);
    const r = by(db);
    expect(r.found).toMatchObject({ status: "at_store", fm_site_state: null, terminal: false });
    expect(r.none).toMatchObject({ status: "in_transit", fm_site_state: "not_found", terminal: false, last_polled_at: NOW_ISO });
    expect(r.o1).toMatchObject({ status: "in_transit", fm_site_state: "not_dropped", terminal: false });
    expect(r.old).toMatchObject({ status: "in_transit", fm_site_state: "not_found", terminal: true });
    expect(r.date).toMatchObject({ status: "in_transit", fm_site_state: "not_found", terminal: true });
    expect(r.ans).toMatchObject({ fm_site_state: null, terminal: false, last_polled_at: NOW_ISO });
    expect(stats).toMatchObject({ checked: 6, notFound: 4, notShipped: 1, left: 2 });
  });
  it("the write of a parcel that leaves: only the check time, the fact and 'finished' — status untouched", async () => {
    const db = fakeDb({ rows: ROWS() });
    await check(db);
    const old = db.writes().filter((w) => w.eqs.some(([c, v]) => c === "id" && v === "old"));
    expect(old.map((w) => w.patch)).toEqual([{ last_polled_at: NOW_ISO, fm_site_state: "not_found", terminal: true }]);
    // every write is this row, this seller, 全家, still unfinished (unchanged guard)
    for (const w of db.writes()) expect(w.eqs).toEqual(expect.arrayContaining([["user_id", U1], ["carrier", "fm"], ["terminal", false]]));
  });
  it("the written words are only the two the database allows", async () => {
    const db = fakeDb({ rows: ROWS() });
    await check(db);
    const said = db.writes().map((w) => w.patch?.fm_site_state).filter((v) => v !== undefined);
    expect([...new Set(said)].sort()).toEqual([null, "not_dropped", "not_found"].sort());
  });
});

describe("the server's own read gives the check what it needs", () => {
  it("a parcel answered once before keeps no 'nothing yet' mark — through selectFmRows, not rows handed in", async () => {
    const db = fakeDb({ rows: ROWS() });
    const sel = await selectFmRows(db, U1) as { rows: Row[]; error?: unknown };
    expect(sel.error).toBeFalsy();
    expect(sel.rows).toHaveLength(6);
    for (const k of ["status", "created_at", "pickup_deadline", "fm_answered_at"]) expect(k in sel.rows[0], k).toBe(true);
    const stats = await checkFmRows({ serviceSb: db, rows: sel.rows, userId: U1, daily: { day: "2026-11-19", requests: 0, captchaTries: 0, captchaHits: 0, parcels: 0 }, ocr: { solve: async () => "", dead: false }, sessionImpl: fakeSession as never, now: () => NOW, logger: quiet() as unknown as Console, limits: FAST });
    const r = by(db);
    expect(r.ans).toMatchObject({ fm_site_state: null, terminal: false });
    expect(r.old).toMatchObject({ fm_site_state: "not_found", terminal: true });
    expect(stats).toMatchObject({ checked: 6, left: 2 });
  });
});

describe("sql/185 not applied yet — the check writes exactly what it wrote before", () => {
  it("first 'column not found' → warned once, written again without the fact; every later write is the old one", async () => {
    const db = fakeDb({ rows: ROWS(), noColumn: true });
    const { stats, logger } = await check(db);
    const ok = db.writes().filter((w) => !("fm_site_state" in (w.patch ?? {})));
    const refused = db.writes().filter((w) => "fm_site_state" in (w.patch ?? {}));
    expect(refused).toHaveLength(1); // only the first try
    // the rows hold what main's check would have written: no fact, nothing finished for "nothing yet"
    const r = by(db);
    expect(r.found).toMatchObject({ status: "at_store", terminal: false });
    for (const id of ["none", "o1", "old", "date", "ans"]) expect(r[id], id).toMatchObject({ status: "in_transit", terminal: false, fm_site_state: null, last_polled_at: NOW_ISO });
    expect(ok.map((w) => w.patch)).toEqual(ROWS().map((row) => (fmRowChange(SAYS[row.tracking_no as string] as never, row, NOW_ISO) as { plain: unknown }).plain));
    expect(stats).toMatchObject({ checked: 6, notFound: 4, notShipped: 1, left: 0 });
    expect(lines(logger).match(/saved-answer column is not in the database yet/g)).toHaveLength(1);
  });
  it("the error test: only a missing column counts", () => {
    expect(fmStateColumnMissing({ code: "PGRST204", message: "x" })).toBe(true);
    expect(fmStateColumnMissing({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(fmStateColumnMissing({ code: "XX", message: 'column "fm_site_state" of relation "parcel_tracking" does not exist' })).toBe(true);
    expect(fmStateColumnMissing({ code: "23514", message: "new row violates check constraint" })).toBe(false);
    expect(fmStateColumnMissing({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(fmStateColumnMissing(null)).toBe(false);
  });
  it("any OTHER write error is not retried and changes nothing (as before)", async () => {
    const db = fakeDb({ rows: [mk("none", T_NONE)], writeError: "57014" });
    const { stats, logger } = await check(db);
    expect(db.writes()).toHaveLength(1);
    expect(stats.checked).toBe(0);
    expect(db.rows[0]).toMatchObject({ fm_site_state: null, last_polled_at: null });
    expect(lines(logger)).not.toMatch(/saved-answer column/);
  });
});

describe("the run's counts are saved with the 全家 health row", () => {
  const plan = { run: true, rows: ROWS(), capped: false, image: undefined, failStreak: 0 };
  const job = { id: "J1", user_id: U1, kind: "manual" };
  const runIt = (db: ReturnType<typeof fakeDb>, logger = quiet()) => runFmPlan({
    serviceSb: db, job, plan: { ...plan, rows: db.rows }, ocr: { solve: async () => "", dead: false }, now: () => NOW, logger, limits: FAST,
    checkImpl: (args: Record<string, unknown>) => checkFmRows({ ...args, sessionImpl: fakeSession } as never),
  }).then((out: Record<string, unknown>) => ({ out, logger }));
  it("fm_not_found / fm_not_shipped / fm_left on the row of the run; 'left=' in the done line", async () => {
    const db = fakeDb({ rows: ROWS() });
    const { logger } = await runIt(db);
    expect(db.health).toHaveLength(1);
    expect(db.health[0]).toMatchObject({ kind: "fm", job_id: "J1", updated: 6, fm_not_found: 4, fm_not_shipped: 1, fm_left: 2 });
    expect(lines(logger)).toMatch(/\[FM-CHECK\] done job=J1 .* not_found=4 not_shipped=1 left=2 /);
  });
  it("sql/185 not applied → the health row of before (no count columns), written once", async () => {
    const db = fakeDb({ rows: ROWS(), noColumn: true });
    await runIt(db);
    expect(db.health).toHaveLength(1);
    expect(Object.keys(db.health[0]).filter((k) => k.startsWith("fm_"))).toEqual([]);
    expect(db.health[0]).toMatchObject({ kind: "fm", job_id: "J1", updated: 6 });
  });
  it("no parcel number, buyer name or phone in any log line of the run", async () => {
    const rows = ROWS().map((r) => ({ ...r, recipient_name: "王小明", buyer_username: "secret_buyer", phone: "0912345678" }));
    const db = fakeDb({ rows });
    const { logger } = await runIt(db);
    const all = lines(logger);
    for (const no of [T_FOUND, T_NONE, T_01, T_OLD, T_DATE, T_ANS]) expect(all, no).not.toContain(no);
    expect(all).not.toMatch(/\d{11}/);
    for (const s of ["王小明", "secret_buyer", "0912345678"]) expect(all).not.toContain(s);
  });
});

// ── A. the seller's press asks every unfinished 全家 parcel ──────────────────────
describe("A — fmScopeForJob: manual = every parcel, the 7-11 order; the other jobs unchanged", () => {
  const caps = { parcels: FM_PARCELS_PER_JOB };
  const r = (id: string, o: Row = {}): Row => ({ id, status: "in_transit", last_polled_at: null, pickup_deadline: null, created_at: "2026-11-15T00:00:00.000Z", ...o });
  const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
  it("no 24-hour skip: a parcel checked an hour ago is asked again", () => {
    const rows = [r("fresh", { last_polled_at: hourAgo })];
    expect(scopeForJob({ kind: "manual" }, rows, NOW, caps).rows).toEqual([]);           // the old rule skipped it
    expect(fmScopeForJob({ kind: "manual" }, rows, NOW, caps).rows.map((x: Row) => x.id)).toEqual(["fresh"]);
    expect(IN_TRANSIT_FRESH_MS).toBe(24 * 60 * 60 * 1000);
  });
  it("order: at a store first, nearest pickup deadline first; then the rest, least recently checked first (never checked first)", () => {
    const rows = [
      r("moving_new", { last_polled_at: "2026-11-19T01:00:00.000Z" }),
      r("store_late", { status: "at_store", pickup_deadline: "2026-11-26" }),
      r("never", {}),
      r("moving_old", { last_polled_at: "2026-11-17T01:00:00.000Z" }),
      r("store_soon", { status: "at_store", pickup_deadline: "2026-11-20" }),
      r("store_nodate", { status: "at_store" }),
    ];
    expect(fmScopeForJob({ kind: "manual" }, rows, NOW, caps).rows.map((x: Row) => x.id))
      .toEqual(["store_soon", "store_late", "store_nodate", "never", "moving_old", "moving_new"]);
    expect(fmScopeForJob({ kind: "manual" }, rows, NOW, caps).rows).toEqual(orderForCheck(rows));
  });
  it("keeps the 60-per-job limit; capped = some were left for the next check", () => {
    expect(FM_PARCELS_PER_JOB).toBe(60);
    const rows = Array.from({ length: 70 }, (_, i) => r(`p${i}`, { last_polled_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }));
    const s = fmScopeForJob({ kind: "manual" }, rows, NOW, caps);
    expect(s.rows).toHaveLength(60);
    expect(s.capped).toBe(true);
    expect(s.rows[0].id).toBe("p0");
    expect(fmScopeForJob({ kind: "manual" }, rows.slice(0, 60), NOW, caps).capped).toBe(false);
  });
  it("urgent / new_parcels / health / anything else → exactly scopeForJob (unchanged)", () => {
    const rows = [
      r("a", { status: "at_store", pickup_deadline: "2026-11-20" }), r("b", { status: "at_store", pickup_deadline: "2026-11-25" }),
      r("c", { created_at: "2026-11-19T02:58:00.000Z" }), r("d", { last_polled_at: hourAgo }),
    ];
    for (const job of [{ kind: "urgent" }, { kind: "new_parcels", requested_at: "2026-11-19T03:00:00.000Z" }, { kind: "health" }, { kind: "auto" }, { kind: "weird" }]) {
      expect(fmScopeForJob(job, rows, NOW, caps), job.kind).toEqual(scopeForJob(job, rows, NOW, caps));
    }
  });
  it("the worker uses it for the 全家 part of every non-automatic job; the 7-11 part and the automatic check are not touched", () => {
    const src = read("../../../../server/parcelTrackingWorker.js");
    expect(src).toContain(": fmScopeForJob(job, list, now(), { ...caps, parcels: FM_PARCELS_PER_JOB }));");
    expect(src).toContain("? autoScope(list, now(), { ...auto, maxParcels: Math.min(auto.maxParcels, FM_PARCELS_PER_JOB) }, tier)");
    expect(src).toContain(": sevenScopeForJob(job, list, now(), caps));");
    expect(src).not.toMatch(/fmScopeForJob\(job, list, now\(\), caps\)/);
  });
});
