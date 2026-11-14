// 1.18.2 — the LIVE frozen lane works at NIGHT (01:00–05:00 Taipei) like the dry lane does.
// Before: the live frozen lane was fully off in the window (no pending read, no request), so a frozen
// parcel made at night got no answer — not even from store_frozen_cache — until 05:00.
// Now, at night:
//   • the frozen pending read RUNS (sql/157's cache step answers from store_frozen_cache there);
//   • the live request is SENT (flagged night: true → the content script reads a maintenance page as a
//     no-answer); a real answer is written as usual; a no-answer / timeout / maintenance page / odd page
//     writes NOTHING and is NOT counted (no 10-min lane pause), that store is asked again after 10 min;
//   • a block (403 / 429 / captcha / login) is never a harmless no-answer: written 'unknown' like by day;
//   • every night request logs `[PC-FROZEN] night send store=… result=…`.
// By DAY nothing changed: the same requests, writes, tab messages and log lines as main's 1.18.1 files
// (run under the same harness, scenario by scenario).
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000, MIN = 60 * S;
const NIGHT = Date.UTC(2026, 0, 15, 18, 0, 0);   // 02:00 Taipei
const DAY = Date.UTC(2026, 0, 15, 2, 0, 0);      // 10:00 Taipei
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
type W = ReturnType<typeof bootWorker>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "test", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const ROWS = [
  { id: "fz-a", store_id: "968551", created_at: new Date(NIGHT - 60 * S).toISOString(), queue_depth: 2 },
  { id: "fz-b", store_id: "151003", created_at: new Date(NIGHT - 50 * S).toISOString(), queue_depth: 2 },
];
const liveMsgs = (w: W) => w.calls.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK" && !String(m.rowId ?? "").startsWith("warmup:"));
const verdicts = (w: W) => w.calls.fetch.map((u, i) => [u, w.calls.fetchBodies[i]] as const)
  .filter(([u]) => /admin_parcel_frozen_verdict/.test(u)).map(([, b]) => JSON.parse(b) as { p_id: string; p_status: string });
const pendingReads = (w: W) => w.calls.fetch.filter((u) => /admin_parcel_frozen_pending/.test(u)).length;

// replies the content script gives (emap-frozen-711.js shapes)
const R = {
  ok: { frozen_store_status: "ok", frozen_reason: "", transient: false },
  no_frozen: { frozen_store_status: "no_frozen", frozen_reason: "", transient: false },
  no2: { frozen_store_status: "unknown", frozen_reason: "store not found (NO2)", transient: false },
  close: { frozen_store_status: "unknown", frozen_reason: "company store (close)", transient: false },
  timeout: { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx timeout (2.5s)", transient: true },
  maint: { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx maintenance page", transient: true, maintenance: true },
  odd: { frozen_store_status: "unknown", frozen_reason: '/ecmap/byIDData.aspx unexpected response: ""', transient: false, blocked: false },
  http403: { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx returned HTTP 403", transient: false, blocked: true },
  captcha: { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx redirected to a login / captcha page", transient: false, blocked: true },
} as const;

async function nightRun(opts: Opts, passes: number, start = NIGHT) {
  const clock = { t: start };
  const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, maintenance: true, frozenSwitch: "true", ...opts });
  await w.booted;
  for (let i = 0; i < passes; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
  return { w, clock };
}

describe("night: a real answer is written as usual", () => {
  for (const [name, reply, status] of [["ok", R.ok, "ok"], ["no_frozen", R.no_frozen, "no_frozen"], ["NO2 (store not found)", R.no2, "unknown"], ["close (company store)", R.close, "unknown"]] as const) {
    it(`${name} → written '${status}', one log line "night send store=… result=${status}"`, async () => {
      const { w } = await nightRun({ frozenPending: [ROWS[0]], frozenReply: () => ({ ...reply }) }, 12);
      expect(pendingReads(w)).toBeGreaterThan(0);                           // the pending read runs at night
      expect(liveMsgs(w)[0]).toMatchObject({ rowId: "fz-a", night: true });
      expect(liveMsgs(w)[0].nightWarm).toBeUndefined();
      expect(verdicts(w)[0]).toEqual({ p_id: "fz-a", p_expected_store: "968551", p_status: status });
      expect(w.calls.logs.some((l) => l.startsWith(`[PC-FROZEN] night send store=968551 row=fz-a result=${status}`))).toBe(true);
    });
  }
});

describe("night: a no-answer writes nothing, is not counted, and that store is asked again after 10 min", () => {
  for (const [name, reply] of [["timeout", R.timeout], ["maintenance page", R.maint], ["odd / empty page", R.odd], ["no reply at all", null], ["the tab throws", "throw"]] as const) {
    it(`${name} → nothing written, no lane pause (the other store is checked on the next pass), store retried ≥ 10 min later`, async () => {
      const at: Record<string, number[]> = { "fz-a": [], "fz-b": [] };
      const clock = { t: NIGHT };
      const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: ROWS,
        frozenReply: reply === "throw" ? undefined : (row) => { at[String(row?.id)].push(clock.t); return row?.id === "fz-a" ? (reply === null ? null : { ...reply }) : null; },
        frozenVerdict: reply === "throw" ? (row) => { at[String(row?.id)].push(clock.t); return row?.id === "fz-a" ? "throw" : null; } : undefined });
      await w.booted;
      for (let i = 0; i < 12 * 25; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }   // 25 min
      expect(verdicts(w).filter((v) => v.p_id === "fz-a")).toEqual([]);                            // nothing written
      expect(w.calls.logs.some((l) => /paused 10 min/.test(l))).toBe(false);                       // not counted: no lane pause
      expect(at["fz-b"].length).toBeGreaterThan(0);
      expect(at["fz-b"][0] - at["fz-a"][0]).toBeLessThan(MIN);                                      // the other store goes on right away
      expect(at["fz-a"].length).toBeGreaterThanOrEqual(2);                                          // retried…
      for (let i = 1; i < at["fz-a"].length; i++) expect(at["fz-a"][i] - at["fz-a"][i - 1]).toBeGreaterThanOrEqual(10 * MIN); // …never sooner than 10 min
      expect(w.calls.logs.some((l) => /^\[PC-FROZEN\] night send store=968551 row=fz-a result=no_answer \(.*\) — nothing written, retry in 10 min$/.test(l))).toBe(true);
    });
  }
  it("contrast — by DAY the same no-answer is written 'unknown' and pauses the whole lane 10 min (unchanged)", async () => {
    const at: Record<string, number[]> = { "fz-a": [], "fz-b": [] };
    const clock = { t: DAY };
    const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: ROWS,
      frozenReply: (row) => { at[String(row?.id)].push(clock.t); return { ...R.timeout }; } });
    await w.booted;
    for (let i = 0; i < 12 * 5; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(verdicts(w).filter((v) => v.p_id === "fz-a")).toEqual([{ p_id: "fz-a", p_expected_store: "968551", p_status: "unknown" }]);
    expect(at["fz-b"]).toEqual([]);                                                                 // paused
    expect(w.calls.logs.some((l) => /frozen checks paused 10 min/.test(l))).toBe(true);
    expect(w.calls.logs.some((l) => /night send/.test(l))).toBe(false);
  });
});

describe("night: a block is never a harmless no-answer", () => {
  for (const [name, reply] of [["HTTP 403", R.http403], ["login / captcha page", R.captcha]] as const) {
    it(`${name} → written 'unknown' exactly like by day (logged as blocked), never the 'not counted' path`, async () => {
      const { w } = await nightRun({ frozenPending: [ROWS[0]], frozenReply: () => ({ ...reply }) }, 12);
      expect(verdicts(w)[0]).toEqual({ p_id: "fz-a", p_expected_store: "968551", p_status: "unknown" });
      expect(w.calls.logs.some((l) => l.startsWith("[PC-FROZEN] night send store=968551 row=fz-a result=unknown (blocked)"))).toBe(true);
      expect(w.calls.logs.some((l) => /result=no_answer/.test(l))).toBe(false);
    });
  }
});

describe("night: the cache answer", () => {
  it("the frozen pending read runs at night (it is the call whose cache step writes store_frozen_cache answers onto the parcels)", async () => {
    const { w } = await nightRun({ frozenPending: [] }, 12);
    expect(pendingReads(w)).toBeGreaterThan(0);
  });
  it("sql/157's pending function has no time-of-day rule: the cache step applies at any hour", () => {
    const sql = readFileSync("sql/157_frozen_verdict_exported.sql", "utf8");
    const i = sql.indexOf("create or replace function public.admin_parcel_frozen_pending(");
    const fn = sql.slice(i, sql.indexOf("end $$;", i)).replace(/--[^\n]*/g, "");
    expect(fn).toContain("with hit as (");
    expect(fn).not.toMatch(/Taipei|at time zone|extract\s*\(|date_part|::time\b|pcInMaintenance/i);
  });
});

describe("night: the content script reads `night: true` like the warm-up's night flag", () => {
  it("only the night message turns on the maintenance-page reading; a day message has neither flag", () => {
    const cs = readFileSync("chrome-extension/emap-frozen-711.js", "utf8");
    expect(cs).toContain("checkFrozenStore(message.row.store_id, guid, message.nightWarm === true || message.night === true)");
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(mod).toContain('pcSendTab(tabId, { type: "PC_FROZEN_CHECK", row, night: true })');
    expect(mod).toContain('pcSendTab(tabId, { type: "PC_FROZEN_CHECK", row })');               // the day message, unchanged
  });
});

// ── DAY = main, byte for byte ───────────────────────────────────────────────────
let mainDir = "";
beforeAll(() => {
  mainDir = join(tmpdir(), `sfl-main-ext-night-${process.pid}`);
  mkdirSync(mainDir, { recursive: true });
  let ref = "origin/main";
  try { execSync("git rev-parse --verify --quiet origin/main", { stdio: "pipe" }); } catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); ref = "FETCH_HEAD"; }
  for (const f of ["background.js", "frozen-check.js", "emap-frozen-711.js"]) {
    writeFileSync(join(mainDir, f), execSync(`git show ${ref}:chrome-extension/${f}`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  }
});
const wid = (w: W): string => String((w.storage.pc_worker as { id?: string } | undefined)?.id ?? "");
const norm = (w: W, s: string): string => (wid(w) ? s.split(wid(w)).join("WID") : s);
const fullTrace = (w: W) => ({
  fetch: w.calls.fetch.map((u, i) => [u, norm(w, w.calls.fetchBodies[i])]),
  msgs: w.calls.sendMessage.map((m) => JSON.stringify(m)),
  logs: w.calls.logs.map((l) => norm(w, l)),
});
async function dayRun(opts: Opts, extDir?: string) {
  const clock = { t: DAY };
  const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, maintenance: true, frozenSwitch: "true", ...(extDir ? { extDir } : {}), ...opts });
  await w.booted;
  for (let i = 0; i < 12 * 12; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }       // 12 min
  return w;
}
function warmList(n: number) {
  return () => Array.from({ length: Math.min(5, n) }, (_, i) => ({ store_id: String(600001 + i), left_count: n, checked_count: 0 }));
}
describe("DAY: identical to main's 1.18.1 extension (requests, writes, tab messages, log lines)", () => {
  const scenarios: [string, Opts][] = [
    ["real answers", { frozenPending: ROWS, frozenReply: (row) => ({ ...(row?.id === "fz-a" ? R.ok : R.no_frozen) }) }],
    ["timeout → lane pause", { frozenPending: ROWS, frozenReply: () => ({ ...R.timeout }) }],
    ["no reply", { frozenPending: ROWS, frozenReply: () => null }],
    ["blocked", { frozenPending: ROWS, frozenReply: () => ({ ...R.http403 }) }],
    ["NO2", { frozenPending: ROWS, frozenReply: () => ({ ...R.no2 }) }],
    ["empty queue + warm-up on", { rows: [], frozenPending: [], warmupSwitch: "true", warmupNext: warmList(20), frozenReply: () => ({ ...R.ok }) }],
    ["switch off", { frozenSwitch: "false", frozenPending: ROWS }],
  ];
  for (const [name, o] of scenarios) {
    it(name, async () => {
      const branch = await dayRun({ ...o });
      const main = await dayRun({ ...o }, mainDir);
      expect(fullTrace(branch)).toEqual(fullTrace(main));
      expect(branch.calls.sendMessage.some((m) => m.night !== undefined)).toBe(false);
    });
  }
});
