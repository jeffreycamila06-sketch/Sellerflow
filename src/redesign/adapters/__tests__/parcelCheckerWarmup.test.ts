// 1.18.0 — the FROZEN WARM-UP lane (chrome-extension/frozen-check.js) under the real worker in the vm
// harness. Pinned rules:
//   • frozen switch OFF → no warm-up traffic at all (not even the warm-up switch read);
//   • warm-up switch off / missing → no warm-up RPC, no warm-up E-Map request;
//   • ON + idle → ONE store per 60 s (the pace), answers written through admin_frozen_warmup_verdict;
//   • real work first: a dry parcel pending, or a frozen parcel waiting → no warm-up request (and the
//     heavy store-list read is not made either);
//   • safety: captcha / login / block / HTTP 403 / 429 → STOP (switch off via admin_frozen_warmup_stop +
//     reason in the popup state), restart only after the switch is seen off and then on again;
//     3 no-answers in a row → 30-min pause (NO2 / close answers do not count); a no-answer writes NO
//     verdict; 2 pauses in a row with no real verdict → STOP;
//   • leader-only on a FRESH CONFIRMED lease (never on the fail-open path), maintenance window respected,
//     the request only within 2 s of the kick, the store list never re-read sooner than 5 min;
//   • the pace / pause / counters / stop survive a worker restart (pc_frozen_warmup.mem); the popup
//     line is {on:false} at boot and whenever the frozen switch is seen off.
import { describe, it, expect } from "vitest";
import { bootWorker } from "./parcelCheckerHarness";

const S = 1000;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei (outside the maintenance window)
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
type W = ReturnType<typeof bootWorker>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "test", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const STANDBY: Opts["lease"] = () => ({ json: { leader: false, reason: "standby", leader_id: "other", leader_label: "Mac", leader_age_s: 3, standby_ready: true, standby_age_s: 0, ttl_s: 120 } });
const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// The store list: hands out the not-yet-answered stores (like the RPC: a warmed store is no longer due).
function storeList(n: number, done: Set<string>) {
  const all = Array.from({ length: n }, (_, i) => String(600001 + i));
  return (body: Record<string, unknown>) => {
    const left = all.filter((s) => !done.has(s));
    return left.slice(0, Number(body.p_limit) || 1).map((s) => ({ store_id: s, frozen_history: false, parcels: 1, left_count: left.length, checked_count: done.size }));
  };
}
const warmMsgs = (w: W) => w.calls.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK" && String(m.rowId ?? "").startsWith("warmup:"));
const liveFrozenMsgs = (w: W) => w.calls.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK" && !String(m.rowId ?? "").startsWith("warmup:"));
const bodiesOf = (w: W, re: RegExp) => w.calls.fetch.map((u, i) => [u, w.calls.fetchBodies[i]] as const).filter(([u]) => re.test(u)).map(([, b]) => JSON.parse(b || "{}") as Record<string, unknown>);
const count = (w: W, re: RegExp) => w.calls.fetch.filter((u) => re.test(u)).length;
const WARM_GET = /app_settings\?select=key,value&key=eq\.frozen_warmup_enabled$/;
// the popup part of pc_frozen_warmup (the `mem` part is the restart memory)
const shown = (w: W) => { const { mem: _mem, ...rest } = (w.storage.pc_frozen_warmup ?? {}) as Record<string, unknown>; return rest; };
const memOf = (w: W) => ((w.storage.pc_frozen_warmup ?? {}) as { mem?: Record<string, unknown> }).mem ?? {};

// The SAME opts object goes to the harness (defaults filled in place), so a test can change the
// world mid-run (opts.rows / frozenPending / warmupSwitch / frozenReply) and the worker sees it.
async function boot(opts: Opts) {
  const clock = { t: T0 };
  const defaults: Opts = { rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [] };
  for (const [k, v] of Object.entries(defaults)) if (!(k in opts)) (opts as Record<string, unknown>)[k] = v;
  opts.now = () => clock.t;
  const w = bootWorker(opts);
  await w.booted;
  return { w, clock };
}
// one pass = one pcTick, then 5 s; `at` records the clock when a warm-up check is answered
async function ticks(w: W, clock: { t: number }, n: number) { for (let i = 0; i < n; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; } }

describe("off = nothing", () => {
  it("frozen switch OFF (warm-up 'true'): no warm-up switch read, no warm-up RPC, no warm-up request", async () => {
    const done = new Set<string>();
    const { w, clock } = await boot({ frozenSwitch: "false", warmupSwitch: "true", warmupNext: storeList(20, done) });
    await ticks(w, clock, 60);
    expect(count(w, WARM_GET)).toBe(0);
    expect(count(w, /admin_frozen_warmup_/)).toBe(0);
    expect(warmMsgs(w)).toEqual([]);
    expect(shown(w)).toEqual({ on: false });                                // 12: written {on:false} at boot (storage only — no request)
  });
  for (const sw of ["false", "missing"] as const) {
    it(`warm-up switch ${sw} (frozen on): the switch read ≤ once a minute, nothing else`, async () => {
      const done = new Set<string>();
      const { w, clock } = await boot({ warmupSwitch: sw, warmupNext: storeList(20, done) });
      await ticks(w, clock, 60); // 5 min
      expect(count(w, WARM_GET)).toBeGreaterThan(0);
      expect(count(w, WARM_GET)).toBeLessThanOrEqual(6);
      expect(count(w, /admin_frozen_warmup_/)).toBe(0);
      expect(warmMsgs(w)).toEqual([]);
      expect(shown(w)).toEqual({ on: false });
    });
  }
});

describe("on + idle", () => {
  it("ONE store per 60 s; each answer written through admin_frozen_warmup_verdict (store id + status only)", async () => {
    const done = new Set<string>(); const at: number[] = [];
    const ref = { t: 0 };
    const { w, clock } = await boot({
      warmupSwitch: "true", warmupNext: storeList(50, done),
      frozenReply: (row) => { at.push(ref.t); done.add(String(row?.store_id)); return { frozen_store_status: Number(row?.store_id) % 2 ? "ok" : "no_frozen", frozen_reason: "", transient: false }; },
    });
    ref.t = clock.t; const step = async (n: number) => { for (let i = 0; i < n; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; } };
    await step(12 * 10 + 1);                                        // 10 min of passes
    const n = warmMsgs(w).length;
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(10);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(60 * S); // the pace
    const v = bodiesOf(w, /admin_frozen_warmup_verdict/);
    expect(v).toHaveLength(n);
    expect(Object.keys(v[0]).sort()).toEqual(["p_status", "p_store"]);
    expect(v.map((b) => b.p_store)).toEqual(warmMsgs(w).map((m) => String(m.rowId).replace("warmup:", "")));
    expect(count(w, /admin_frozen_warmup_next/)).toBeLessThanOrEqual(4);   // the heavy list read: 5 stores at a time, ≤ once per 5 min
    expect(bodiesOf(w, /admin_frozen_warmup_next/)[0]).toEqual({ p_limit: 5 });
    const st = w.storage.pc_frozen_warmup as Record<string, unknown>;
    expect(st.on).toBe(true);
    expect(st.lastAt).toBeTypeOf("number");
    expect(w.calls.logs.some((l) => /\[PC-WARMUP\] warm-up store=600001 → ok/.test(l))).toBe(true);
  });
  it("standby → nothing; maintenance window (01:00–05:00 Taipei) → nothing", async () => {
    const done = new Set<string>();
    const sb = await boot({ lease: STANDBY, warmupSwitch: "true", warmupNext: storeList(20, done) });
    await ticks(sb.w, sb.clock, 40);
    expect(warmMsgs(sb.w)).toEqual([]);
    const clock = { t: Date.UTC(2026, 0, 15, 17, 30, 0) };                  // 01:30 Taipei
    const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [], warmupSwitch: "true", warmupNext: storeList(20, done), maintenance: true });
    await w.booted;
    await ticks(w, clock, 40);
    expect(warmMsgs(w)).toEqual([]);
  });
});

describe("real parcels first", () => {
  it("a dry parcel pending → no warm-up request and no store-list read (the heavy query waits for idle)", async () => {
    const done = new Set<string>();
    const { w, clock } = await boot({ rows: undefined, warmupSwitch: "true", warmupNext: storeList(20, done) }); // rows: the default pending dry row, every pass
    await ticks(w, clock, 60);
    expect(w.calls.sendMessage.some((m) => m.type === "PC_CHECK_STORE")).toBe(true);
    expect(warmMsgs(w)).toEqual([]);
    expect(count(w, /admin_frozen_warmup_next/)).toBe(0);
  });
  it("a frozen parcel waiting → the frozen parcel is checked, no warm-up request", async () => {
    const done = new Set<string>();
    const rows = [{ id: "fz-1", store_id: "968551", queue_depth: 1 }, { id: "fz-2", store_id: "151003", queue_depth: 1 }];
    const { w, clock } = await boot({ frozenPending: rows, warmupSwitch: "true", warmupNext: storeList(20, done), frozenVerdict: () => "unknown" });
    await ticks(w, clock, 60);
    expect(liveFrozenMsgs(w).length).toBeGreaterThan(0);
    expect(warmMsgs(w)).toEqual([]);
  });
  it("idle → warm-up runs; a dry parcel appears → warm-up stops at once; gone again → it resumes", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 24);                                              // 2 min idle
    const before = warmMsgs(w).length;
    expect(before).toBeGreaterThan(0);
    opts.rows = [{ id: "dry-9", phone: "0912345678", store_id: "195965", gm_id: "GM1", sender_phone: "0979593026", need_phone: true, need_store: true, queue_depth: 1, created_at: new Date(clock.t).toISOString() }];
    await ticks(w, clock, 36);                                              // 3 min busy
    expect(warmMsgs(w).length).toBe(before);
    opts.rows = [];
    await ticks(w, clock, 36);                                              // 3 min idle again
    expect(warmMsgs(w).length).toBeGreaterThan(before);
  });
});

describe("safety", () => {
  const blocks: [string, Record<string, unknown>][] = [
    ["HTTP 403", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx returned HTTP 403", transient: false, blocked: true }],
    ["HTTP 429", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx returned HTTP 429", transient: false, blocked: true }],
    ["a captcha page (no flag, reason text)", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx unexpected response: \"<html>請輸入驗證碼 captcha\"", transient: false }],
    ["a login page", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx redirected to a login / captcha page", transient: false, blocked: true }],
  ];
  for (const [name, reply] of blocks) {
    it(`${name} → warm-up STOPS: switch turned off with the reason, no more warm-up requests; the live frozen lane keeps working`, async () => {
      const done = new Set<string>();
      const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => (String(row?.id).startsWith("warmup:") ? reply : { frozen_store_status: "no_frozen" }) };
      const { w, clock } = await boot(opts);
      await ticks(w, clock, 24);
      expect(warmMsgs(w)).toHaveLength(1);
      const stops = bodiesOf(w, /admin_frozen_warmup_stop/);
      expect(stops).toHaveLength(1);
      expect(String(stops[0].p_reason)).toBe(String(reply.frozen_reason));
      expect(bodiesOf(w, /admin_frozen_warmup_verdict/)).toEqual([]);      // a block is never written as a verdict
      const st = w.storage.pc_frozen_warmup as Record<string, unknown>;
      expect(st.stopped).toBe(true);
      expect(st.stopReason).toBe(String(reply.frozen_reason));
      expect(w.calls.logs.some((l) => /\[PC-WARMUP\] warm-up STOPPED/.test(l))).toBe(true);
      await ticks(w, clock, 120);                                           // 10 more minutes, the switch row still says 'true'
      expect(warmMsgs(w)).toHaveLength(1);
      opts.frozenPending = [{ id: "fz-9", store_id: "968551", queue_depth: 1 }]; // a real frozen parcel arrives
      await ticks(w, clock, 24);
      expect(liveFrozenMsgs(w).map((m) => m.rowId)).toContain("fz-9");
      expect(warmMsgs(w)).toHaveLength(1);
      // Jeff turns it on again: the switch is seen 'false', then 'true' → warm-up resumes
      opts.frozenPending = []; opts.warmupSwitch = "false";
      await ticks(w, clock, 24);
      opts.warmupSwitch = "true"; opts.frozenReply = (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; };
      await ticks(w, clock, 36);
      expect(warmMsgs(w).length).toBeGreaterThan(1);
      expect((w.storage.pc_frozen_warmup as Record<string, unknown>).stopped).toBe(false);
    });
  }
  it("the stop write fails → retried every pass until it lands; warm-up stays stopped meanwhile", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupStopHttp: 500, warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "HTTP 403", blocked: true }) };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 24);
    const tries = count(w, /admin_frozen_warmup_stop/);
    expect(tries).toBeGreaterThan(1);
    opts.warmupStopHttp = 200;
    await ticks(w, clock, 4);
    const after = count(w, /admin_frozen_warmup_stop/);
    await ticks(w, clock, 12);
    expect(count(w, /admin_frozen_warmup_stop/)).toBe(after);              // landed → no more tries
    expect(warmMsgs(w)).toHaveLength(1);
  });
  for (const [name, reply] of [["no answer", null], ["the 2.5 s timeout", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx timeout (2.5s)", transient: true }], ["an error page", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx bounced to error.aspx", transient: false }]] as const) {
    it(`3 × ${name} in a row → warm-up pauses 30 min, then resumes`, async () => {
      const done = new Set<string>();
      const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(80, done), frozenReply: (row) => { done.add(String(row?.store_id)); return reply; } };
      const { w, clock } = await boot(opts);
      await ticks(w, clock, 12 * 5);                                        // 5 min
      expect(warmMsgs(w)).toHaveLength(3);
      expect(w.calls.logs.some((l) => /3 no-answers in a row .* paused 30 min/.test(l))).toBe(true);
      expect((w.storage.pc_frozen_warmup as Record<string, unknown>).pausedUntil).toBeTypeOf("number");
      await ticks(w, clock, 12 * 24);                                       // to ~29 min
      expect(warmMsgs(w)).toHaveLength(3);
      opts.frozenReply = (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; };
      await ticks(w, clock, 12 * 4);                                        // past 30 min
      expect(warmMsgs(w).length).toBeGreaterThan(3);
      // 9: the 3 no-answers wrote NOTHING; only the real answers after the pause are written
      const v = bodiesOf(w, /admin_frozen_warmup_verdict/).map((b) => b.p_status);
      expect(v.length).toBe(warmMsgs(w).length - 3);
      expect(v.every((x) => x === "ok")).toBe(true);
    });
  }
  it("NO2 / close (real answers, just no verdict) never count toward the pause", async () => {
    const done = new Set<string>(); let i = 0;
    const { w, clock } = await boot({ warmupSwitch: "true", warmupNext: storeList(80, done),
      frozenReply: (row) => { done.add(String(row?.store_id)); i += 1; return { frozen_store_status: "unknown", frozen_reason: i % 2 ? "store not found (NO2)" : "company store (close)", transient: false }; } });
    await ticks(w, clock, 12 * 8);                                           // 8 min
    expect(warmMsgs(w).length).toBeGreaterThanOrEqual(7);
    expect(w.calls.logs.some((l) => /paused 30 min/.test(l))).toBe(false);
    // a real answer that is not a verdict IS written as 'unknown' (the 7-day re-ask gap in sql/145 needs it)
    expect(bodiesOf(w, /admin_frozen_warmup_verdict/).map((b) => b.p_status)).toEqual(warmMsgs(w).map(() => "unknown"));
  });
  // 7
  it("2 pauses in a row with no real verdict → warm-up STOPS (stop RPC with the reason), nothing written", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(80, done), frozenReply: (row) => { done.add(String(row?.store_id)); return null; } };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 12 * 5);                                          // 3 misses → pause 1
    expect(warmMsgs(w)).toHaveLength(3);
    expect(bodiesOf(w, /admin_frozen_warmup_stop/)).toEqual([]);
    await ticks(w, clock, 12 * 30);                                         // pause ends, 3 more misses → pause 2 = STOP
    expect(warmMsgs(w)).toHaveLength(6);
    const stops = bodiesOf(w, /admin_frozen_warmup_stop/);
    expect(stops).toHaveLength(1);
    expect(String(stops[0].p_reason)).toMatch(/^2 pauses in a row with no answer from E-Map/);
    expect(bodiesOf(w, /admin_frozen_warmup_verdict/)).toEqual([]);
    expect(shown(w)).toMatchObject({ stopped: true, on: false });
    await ticks(w, clock, 12 * 40);                                         // the switch row still says 'true' → stays stopped
    expect(warmMsgs(w)).toHaveLength(6);
  });
  it("a real verdict between two pauses resets the count → a second pause, no stop", async () => {
    const done = new Set<string>(); let n = 0;
    const { w, clock } = await boot({ warmupSwitch: "true", warmupNext: storeList(80, done),
      frozenReply: (row) => { done.add(String(row?.store_id)); n += 1; return n === 4 ? { frozen_store_status: "ok" } : null; } });
    await ticks(w, clock, 12 * 60);                                          // miss×3 (~0–2 min), pause, ok (~32), miss×3, pause 2 (~35–65)
    expect(bodiesOf(w, /admin_frozen_warmup_stop/)).toEqual([]);
    expect(w.calls.logs.filter((l) => /paused 30 min/.test(l)).length).toBe(2);
    expect(bodiesOf(w, /admin_frozen_warmup_verdict/).map((b) => b.p_status)).toEqual(["ok"]);
  });
});

describe("audit fixes — restart memory, list pace, lease, 2 s window, popup off", () => {
  // 6: worker 1 runs, its chrome.storage is handed to worker 2 (a service-worker restart)
  async function restartFrom(w1: W, at: number, opts: Opts) {
    const clock = { t: at };
    const defaults: Opts = { rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [] };
    for (const [k, v] of Object.entries(defaults)) if (!(k in opts)) (opts as Record<string, unknown>)[k] = v;
    opts.now = () => clock.t;                                                // the SAME opts object → a test can change the world mid-run
    opts.initialStorage = { pc_frozen_warmup: JSON.parse(JSON.stringify(w1.storage.pc_frozen_warmup)) };
    const w2 = bootWorker(opts);
    await w2.booted;
    return { w: w2, clock };
  }
  it("restart mid-pace: the new worker waits out the 60 s from the LAST request", async () => {
    const done = new Set<string>(); const at: number[] = []; const ref = { t: 0 };
    const reply = (row?: { store_id?: string }) => { at.push(ref.t); done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; };
    const a = await boot({ warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: reply });
    for (let i = 0; i < 40 && at.length < 1; i++) { ref.t = a.clock.t; await a.w.sb.pcTick(); await flush(); a.clock.t += 5 * S; }
    expect(warmMsgs(a.w)).toHaveLength(1);
    const last = Number(memOf(a.w).lastAt);
    expect(last).toBe(at[0]);
    const b = await restartFrom(a.w, last + 20 * S, { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: reply });
    for (let i = 0; i < 20; i++) { ref.t = b.clock.t; await b.w.sb.pcTick(); await flush(); b.clock.t += 5 * S; }
    expect(warmMsgs(b.w).length).toBeGreaterThan(0);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(60 * S);                   // the pace held across the restart
  });
  it("restart mid-pause: still paused until the saved time; the miss count survives too", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(80, done), frozenReply: (row) => { done.add(String(row?.store_id)); return null; } };
    const a = await boot(opts);
    await ticks(a.w, a.clock, 12 * 5);
    const m = memOf(a.w);
    expect(Number(m.pauseUntil)).toBeGreaterThan(a.clock.t);
    expect(m.pauses).toBe(1);
    const b = await restartFrom(a.w, a.clock.t + 60 * S, { ...opts, frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    expect(b.w.calls.logs.some((l) => /warm-up state restored \(paused until/.test(l))).toBe(true);
    await ticks(b.w, b.clock, 12 * 20);                                     // 20 min: still inside the 30-min pause
    expect(warmMsgs(b.w)).toEqual([]);
    await ticks(b.w, b.clock, 12 * 12);                                     // past it → resumes
    expect(warmMsgs(b.w).length).toBeGreaterThan(0);
    // and the pause count was carried: 3 more misses on worker 2 would have been pause 2 → stop (checked below)
    const c = await restartFrom(a.w, a.clock.t + 31 * 60 * S, { warmupSwitch: "true", warmupNext: storeList(80, done), frozenReply: (row) => { done.add(String(row?.store_id)); return null; } });
    await ticks(c.w, c.clock, 12 * 5);
    expect(bodiesOf(c.w, /admin_frozen_warmup_stop/)).toHaveLength(1);    // pause #2 after the restart = STOP
  });
  it("restart after a stop: stays stopped (switch row still 'true'), the line says stopped, resumes only after off → on", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "returned HTTP 403", blocked: true }) };
    const a = await boot(opts);
    await ticks(a.w, a.clock, 24);
    expect(memOf(a.w)).toMatchObject({ stopped: true, stopWritten: true });
    const ok = (row?: { store_id?: string }) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; };
    const b2: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: ok };
    const b = await restartFrom(a.w, a.clock.t + 5 * S, b2);
    expect(b.w.calls.logs.some((l) => /warm-up state restored \(stopped: returned HTTP 403\)/.test(l))).toBe(true);
    await ticks(b.w, b.clock, 12 * 5);
    expect(warmMsgs(b.w)).toEqual([]);
    expect(count(b.w, /admin_frozen_warmup_stop/)).toBe(0);                // already written before the restart
    expect(shown(b.w)).toMatchObject({ stopped: true, stopReason: "returned HTTP 403" });
    b2.warmupSwitch = "false"; await ticks(b.w, b.clock, 24);
    b2.warmupSwitch = "true"; await ticks(b.w, b.clock, 36);
    expect(warmMsgs(b.w).length).toBeGreaterThan(0);
    expect(shown(b.w)).toMatchObject({ stopped: false, on: true });
  });
  it("a stop whose write never landed before the restart → written by the new worker", async () => {
    const done = new Set<string>();
    const a = await boot({ warmupSwitch: "true", warmupStopHttp: 500, warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "HTTP 429", blocked: true }) });
    await ticks(a.w, a.clock, 12);
    expect(memOf(a.w)).toMatchObject({ stopped: true, stopWritten: false });
    const b = await restartFrom(a.w, a.clock.t, { warmupSwitch: "true", warmupNext: storeList(50, done) });
    await ticks(b.w, b.clock, 12);
    expect(bodiesOf(b.w, /admin_frozen_warmup_stop/).map((x) => x.p_reason)).toContain("HTTP 429");
  });
  // 8
  it("the store list is never read again sooner than 5 min after the last read — even when the queue ran dry", async () => {
    const done = new Set<string>(); const reads: number[] = [];
    const { w, clock } = await boot({ warmupSwitch: "true",
      warmupNext: (b) => { reads.push(clock.t); return storeList(80, done)(b).slice(0, 1); },     // ONE store per read: the queue empties after 1 check
      frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    await ticks(w, clock, 12 * 16);                                         // 16 min
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < reads.length; i++) expect(reads[i] - reads[i - 1]).toBeGreaterThanOrEqual(5 * 60 * S);
    expect(reads.length).toBeLessThanOrEqual(4);
  });
  // 10
  it("lease fail-open (the lease call failing 3+ min): the frozen lane keeps working, warm-up does NOT", async () => {
    const done = new Set<string>(); let lease: "ok" | "fail" = "ok";
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(80, done), lease: (b) => (lease === "ok" ? (LEADER as NonNullable<Opts["lease"]>)(b) : "throw"),
      frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 12 * 3);
    const before = warmMsgs(w).length;
    expect(before).toBeGreaterThan(0);
    lease = "fail";
    await ticks(w, clock, 12 * 4);                                          // past the 3-min fail-open
    expect(w.calls.logs.some((l) => /lease unreachable for 3\+ min — acting as leader/.test(l))).toBe(true);
    opts.frozenPending = [{ id: "fz-fo", store_id: "968551", queue_depth: 1 }];
    await ticks(w, clock, 12 * 3);
    expect(liveFrozenMsgs(w).map((m) => m.rowId)).toContain("fz-fo");       // the frozen lane still works on fail-open
    opts.frozenPending = [];
    await ticks(w, clock, 12 * 6);
    expect(warmMsgs(w).length).toBe(before);                                 // …but warm-up never ran on it
    lease = "ok";
    await ticks(w, clock, 12 * 4);
    expect(warmMsgs(w).length).toBeGreaterThan(before);                      // a confirmed lease again → resumes
  });
  it("no lease answer yet (pre-1.15 boot rule) → no warm-up; the pure check", async () => {
    const done = new Set<string>();
    const { w, clock } = await boot({ lease: undefined, warmupSwitch: "true", warmupNext: storeList(20, done), frozenReply: () => ({ frozen_store_status: "ok" }) });
    await ticks(w, clock, 40);
    expect(warmMsgs(w)).toEqual([]);
    const t = w.evalIn("pcFrozenKick.__test") as { leaseConfirmed: (n: number) => boolean };
    const set = (code: string) => w.evalIn(code);
    const now = clock.t;
    set(`pcLease.role = "leader"; pcLease.failing = false; pcLease.lastOkAt = ${now - 10 * S};`);
    expect(t.leaseConfirmed(now)).toBe(true);
    set(`pcLease.lastOkAt = ${now - 61 * S}; pcLease.lone = true;`);
    expect(t.leaseConfirmed(now)).toBe(false);                               // a lone leader on a stale lease: no
    set(`pcLease.lastOkAt = ${now - 10 * S}; pcLease.failing = true;`);
    expect(t.leaseConfirmed(now)).toBe(false);                               // the lease call failing: no
    set(`pcLease.failing = false; pcLease.role = "standby";`);
    expect(t.leaseConfirmed(now)).toBe(false);
    set(`pcLease.role = null;`);
    expect(t.leaseConfirmed(now)).toBe(false);
  });
  // 11
  it("more than 2 s since the kick when it is time to send → the warm-up request is skipped", async () => {
    const done = new Set<string>(); const late = { ms: 0 }; const clockRef = { t: 0 };
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), onFrozenPing: () => { clockRef.t += late.ms; },
      frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } };
    const { w, clock } = await boot(opts);
    // the ping hook moves the worker's clock (it reads opts.now)
    Object.defineProperty(clockRef, "t", { get: () => clock.t, set: (v: number) => { clock.t = v; } });
    late.ms = 2500;
    await ticks(w, clock, 24);
    expect(warmMsgs(w)).toEqual([]);
    expect(w.calls.logs.some((l) => /warm-up skipped: \d+ ms since the kick/.test(l))).toBe(true);
    late.ms = 1500;
    await ticks(w, clock, 24);
    expect(warmMsgs(w).length).toBeGreaterThan(0);                           // within 2 s → sent
  });
  // 12
  it("the frozen switch seen OFF → the popup line becomes {on:false} (no stale 'N checked')", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 24);
    expect(shown(w)).toMatchObject({ on: true });
    opts.frozenSwitch = "false";
    await ticks(w, clock, 24);
    expect(shown(w)).toEqual({ on: false });
    const n = warmMsgs(w).length;
    await ticks(w, clock, 24);
    expect(warmMsgs(w)).toHaveLength(n);
  });
  it("…also a STOPPED line: frozen switch OFF → {on:false} (the stop itself is kept in mem)", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "returned HTTP 403", blocked: true }) };
    const { w, clock } = await boot(opts);
    await ticks(w, clock, 24);
    expect(shown(w)).toMatchObject({ stopped: true });
    opts.frozenSwitch = "false";
    await ticks(w, clock, 24);
    expect(shown(w)).toEqual({ on: false });
    expect(memOf(w)).toMatchObject({ stopped: true, stopReason: "returned HTTP 403" });
  });
  it("at boot the saved line is replaced by {on:false} before anything is read (no stale line from the last run)", async () => {
    const w = bootWorker({ rows: [], lease: LEADER, frozenSwitch: "false", frozenPending: [],
      initialStorage: { pc_frozen_warmup: { on: true, checked: 9, left: 3, lastAt: 1, mem: { lastAt: 5 } } } });
    await w.booted; await flush();
    expect(shown(w)).toEqual({ on: false });
    expect(memOf(w).lastAt).toBe(5);                                         // the restart memory is kept
  });
});

describe("pure helpers", () => {
  it("isBlocked / noAnswer / the pace constant", async () => {
    const { w } = await boot({});
    const t = w.evalIn("pcFrozenKick.__test") as { isBlocked: (r: unknown, s: string) => boolean; noAnswer: (r: unknown, s: string) => boolean; WARMUP_GAP_MS: number };
    expect(t.WARMUP_GAP_MS).toBe(60 * S);
    expect(t.isBlocked({ blocked: true }, "")).toBe(true);
    for (const s of ["returned HTTP 403", "returned HTTP 429", "請輸入驗證碼", "reCAPTCHA", "redirected to a login / captcha page", "登入"]) expect(t.isBlocked({}, s), s).toBe(true);
    for (const s of ["returned HTTP 500", "timeout (2.5s)", "store not found (NO2)", "bounced to error.aspx", "returned HTTP 4033"]) expect(t.isBlocked({}, s), s).toBe(false);
    expect(t.noAnswer(null, "")).toBe(true);
    expect(t.noAnswer({ transient: true }, "timeout (2.5s)")).toBe(true);
    expect(t.noAnswer({}, "bounced to error.aspx")).toBe(true);
    expect(t.noAnswer({}, "store not found (NO2)")).toBe(false);
    expect(t.noAnswer({}, "company store (close)")).toBe(false);
  });
  it("frozen-check.js: the pace lives in ONE constant", async () => {
    const { readFileSync } = await import("node:fs");
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(mod.match(/const WARMUP_GAP_MS = 60 \* 1000;/g)).toHaveLength(1);
    expect(mod.match(/60 \* 1000/g)!.length).toBeGreaterThanOrEqual(1);
    expect(mod).toMatch(/nowMs - warm\.lastAt < WARMUP_GAP_MS/);
  });
});
