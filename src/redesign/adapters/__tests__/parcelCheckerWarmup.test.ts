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
  it("standby → nothing; maintenance window (01:00–05:00 Taipei), 1.18.2: a waiting frozen parcel IS checked live at night (warm-up switch off → no probe)", async () => {
    const done = new Set<string>();
    const sb = await boot({ lease: STANDBY, warmupSwitch: "true", warmupNext: storeList(20, done) });
    await ticks(sb.w, sb.clock, 40);
    expect(warmMsgs(sb.w)).toEqual([]);
    const clock = { t: Date.UTC(2026, 0, 15, 17, 30, 0) };                  // 01:30 Taipei
    const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }], warmupSwitch: "false", warmupNext: storeList(20, done), maintenance: true });
    await w.booted;
    await ticks(w, clock, 40);
    expect(warmMsgs(w)).toEqual([]);
    expect(liveFrozenMsgs(w).length).toBeGreaterThan(0);                    // 1.18.2: no longer waits for 05:00
    expect(liveFrozenMsgs(w).every((m) => m.night === true)).toBe(true);
    expect(count(w, /admin_parcel_frozen_pending/)).toBeGreaterThan(0);     // the pending read runs at night (sql/157's cache step)
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
  it("the stop write fails → retried ≤ once per 60 s until it lands; warm-up stays stopped meanwhile", async () => {
    const done = new Set<string>(); const tryAt: number[] = [];
    const opts: Opts = { warmupSwitch: "true", warmupStopHttp: 500, warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "HTTP 403", blocked: true }) };
    const { w, clock } = await boot(opts);
    for (let i = 0; i < 12 * 5; i++) {                                     // 5 min of passes, every stop write failing
      const before = count(w, /admin_frozen_warmup_stop/);
      await w.sb.pcTick(); await flush();
      if (count(w, /admin_frozen_warmup_stop/) > before) tryAt.push(clock.t);
      clock.t += 5 * S;
    }
    expect(tryAt.length).toBeGreaterThanOrEqual(4);                         // retried…
    expect(tryAt.length).toBeLessThanOrEqual(6);                            // …but not every 5 s pass (that would be 60)
    for (let i = 1; i < tryAt.length; i++) expect(tryAt[i] - tryAt[i - 1]).toBeGreaterThanOrEqual(60 * S);
    opts.warmupStopHttp = 200;
    await ticks(w, clock, 13);                                              // the next try (≤ 60 s later) lands
    const after = count(w, /admin_frozen_warmup_stop/);
    await ticks(w, clock, 24);
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

describe("round 2 — load failure, clamps, the load race, stale queue", () => {
  const MIN = 60 * S;
  const fire3s = (w: W) => { const t = w.calls.timers.filter((x) => x.ms === 3000); for (const x of t) x.fn(); w.calls.timers = w.calls.timers.filter((x) => x.ms !== 3000); return t.length; };
  const SAVED = (t: number) => ({ on: true, checked: 9, left: 3, lastAt: t - 10 * MIN, mem: { lastAt: t - 10 * MIN, pauseUntil: 0, misses: 1, pauses: 1, stopped: false, stopReason: "", stopWritten: false, sawOffSinceStop: false, queueAt: t - 1 * MIN, queue: ["600001"] } });
  // E
  it("E: the pc_frozen_warmup read times out → not loaded, NOTHING written over the saved state, warm-up held; the next pass retries and then works", async () => {
    const done = new Set<string>();
    const saved = SAVED(T0);
    const opts: Opts = { holdStorageGet: "pc_frozen_warmup", initialStorage: { pc_frozen_warmup: JSON.parse(JSON.stringify(saved)) }, warmupSwitch: "true", warmupNext: storeList(50, done),
      frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } };
    const { w, clock } = await boot(opts);
    expect(w.calls.heldGets).toHaveLength(1);                               // the boot read, never answered
    expect(fire3s(w)).toBeGreaterThan(0);                                    // its 3 s timeout fires
    await flush();
    expect(w.calls.logs.some((l) => /warm-up state read failed .* retry/.test(l))).toBe(true);
    const t = w.evalIn("pcFrozenKick.__test.warm") as Record<string, unknown>;
    expect(t.loaded).toBe(false);
    expect(t.lastAt).toBe(clock.t);                                          // pace clock = now
    expect(t.queueAt).toBe(clock.t);                                         // list clock = now
    expect(w.storage.pc_frozen_warmup).toEqual(saved);                       // not overwritten
    for (let i = 0; i < 6 && w.calls.heldGets.length < 2; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; } // a pass reaches the warm-up step → retries the read
    expect(w.calls.heldGets).toHaveLength(2);
    expect(warmMsgs(w)).toEqual([]);
    w.calls.heldGets[1].release(); await flush();                            // this time it answers
    expect((w.evalIn("pcFrozenKick.__test.warm") as Record<string, unknown>).pauses).toBe(1); // the saved counter came through the retry
    await ticks(w, clock, 24);
    expect((w.evalIn("pcFrozenKick.__test.warm") as Record<string, unknown>).loaded).toBe(true);
    expect(warmMsgs(w).length).toBeGreaterThan(0);
  });
  // F
  it("F: future saved times are clamped — lastAt / queueAt ≤ now → the first request ~60 s after start, then ≥ 60 s apart", async () => {
    const done = new Set<string>(); const at: number[] = []; const ref = { t: 0 };
    const far = T0 + 10 * 24 * 60 * MIN;
    const { w, clock } = await boot({ warmupSwitch: "true", warmupNext: storeList(50, done),
      initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: far, queueAt: far, pauseUntil: 0, misses: 0, pauses: 0, stopped: false, queue: ["600001", "600002"] } } },
      frozenReply: (row) => { at.push(ref.t); done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    const m = w.evalIn("pcFrozenKick.__test.warm") as { lastAt: number; queueAt: number };
    expect(m.lastAt).toBe(T0); expect(m.queueAt).toBe(T0);
    for (let i = 0; i < 12 * 4; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(at.length).toBeGreaterThan(1);
    expect(at[0] - T0).toBeGreaterThanOrEqual(60 * S);                      // never faster than the pace…
    expect(at[0] - T0).toBeLessThanOrEqual(75 * S);                         // …and not 10 days late
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(60 * S);
  });
  it("F: a huge saved pause is clamped to 30 min → warm-up resumes in ~30 min, not 10 days", async () => {
    const done = new Set<string>();
    const { w, clock } = await boot({ warmupSwitch: "true", warmupNext: storeList(50, done),
      initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: 0, queueAt: 0, pauseUntil: T0 + 10 * 24 * 60 * MIN, misses: 0, pauses: 0, stopped: false, queue: [] } } },
      frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    expect((w.evalIn("pcFrozenKick.__test.warm") as { pauseUntil: number }).pauseUntil).toBe(T0 + 30 * MIN);
    await ticks(w, clock, 12 * 29);
    expect(warmMsgs(w)).toEqual([]);
    await ticks(w, clock, 12 * 4);
    expect(warmMsgs(w).length).toBeGreaterThan(0);
  });
  // G
  it("G: the load race — a slow pc_frozen_warmup read + ticks first → no warm-up request and the saved mem untouched until the read answers (also when the first read times out and the pass must retry it)", async () => {
    const done = new Set<string>();
    const saved = SAVED(T0);
    const { w, clock } = await boot({ holdStorageGet: "pc_frozen_warmup", initialStorage: { pc_frozen_warmup: JSON.parse(JSON.stringify(saved)) },
      warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => { done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    await ticks(w, clock, 24);                                               // 2 min of passes, the read still out
    expect(warmMsgs(w)).toEqual([]);
    expect(count(w, /admin_frozen_warmup_next/)).toBe(0);
    expect(w.storage.pc_frozen_warmup).toEqual(saved);
    // the boot read times out → the next pass that reaches the warm-up step reads again (and waits for it)
    fire3s(w); await flush();
    for (let i = 0; i < 6 && w.calls.heldGets.length < 2; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(w.calls.heldGets.length).toBeGreaterThanOrEqual(2);
    await ticks(w, clock, 12);                                               // that read is still out → still nothing
    expect(warmMsgs(w)).toEqual([]);
    expect(count(w, /admin_frozen_warmup_next/)).toBe(0);
    expect(w.storage.pc_frozen_warmup).toEqual(saved);
    w.calls.heldGets[w.calls.heldGets.length - 1].release(); await flush(); // the read answers
    await ticks(w, clock, 24);
    expect(warmMsgs(w).length).toBeGreaterThan(0);
    expect(warmMsgs(w)[0].rowId).toBe("warmup:600001");                      // the saved queue was used
  });
  // 1 (round 3): a slow warm-up state read never delays a REAL frozen parcel
  it("1: real frozen parcels first — read held: the frozen parcel goes out on the same pass as with no hold; still no warm-up / no mem write", async () => {
    const firstFrozenTick = async (hold: boolean) => {
      const done = new Set<string>();
      const saved = SAVED(T0);
      const opts: Opts = { ...(hold ? { holdStorageGet: "pc_frozen_warmup" } : {}), initialStorage: { pc_frozen_warmup: JSON.parse(JSON.stringify(saved)) },
        warmupSwitch: "true", warmupNext: storeList(50, done), frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }],
        frozenReply: (row) => (String(row?.id).startsWith("warmup:") ? { frozen_store_status: "ok" } : { frozen_store_status: "no_frozen" }) };
      const { w, clock } = await boot(opts);
      let at = -1;
      for (let i = 0; i < 12 && at < 0; i++) { await w.sb.pcTick(); await flush(); if (liveFrozenMsgs(w).some((m) => m.rowId === "fz-1")) at = i; clock.t += 5 * S; }
      return { at, w, saved };
    };
    const free = await firstFrozenTick(false);
    const held = await firstFrozenTick(true);
    expect(free.at).toBeGreaterThanOrEqual(0);
    expect(held.at).toBe(free.at);                                           // no extra wait for the real parcel
    expect(warmMsgs(held.w)).toEqual([]);
    expect(held.w.storage.pc_frozen_warmup).toEqual(held.saved);             // nothing written while the read is out
  });
  // 3 (round 3)
  it("3: the 'state read failed' log is throttled to once a minute", async () => {
    const { w, clock } = await boot({ holdStorageGet: "pc_frozen_warmup", warmupSwitch: "true", warmupNext: storeList(50, new Set()) });
    for (let i = 0; i < 6; i++) {                                            // six failed reads within ~30 s
      fire3s(w); await flush();
      for (let k = 0; k < 4; k++) { await w.sb.pcTick(); await flush(); clock.t += 1 * S; }
    }
    const n = w.calls.logs.filter((l) => /warm-up state read failed/.test(l)).length;
    expect(w.calls.heldGets.length).toBeGreaterThan(3);
    expect(n).toBe(1);
  });
  // H
  it("H: a saved queue older than 5 min is dropped on restore; a younger one is kept", async () => {
    // the list read FAILS here, so the only store that can be sent is the restored one
    const run = async (ageMin: number) => {
      const { w, clock } = await boot({ warmupSwitch: "true", warmupNext: "error",
        initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: 0, queueAt: T0 - ageMin * MIN, pauseUntil: 0, misses: 0, pauses: 0, stopped: false, queue: ["699999"] } } },
        frozenReply: () => ({ frozen_store_status: "ok" }) });
      await ticks(w, clock, 24);
      return warmMsgs(w).map((m) => m.rowId);
    };
    expect(await run(2)).toEqual(["warmup:699999"]);                        // 2 min old → kept and used
    expect(await run(6)).toEqual([]);                                        // 6 min old → dropped, nothing to send
  });
  it("H: source pins — the load never awaits the state write; the header says switch-off is one local write per start", async () => {
    const { readFileSync } = await import("node:fs");
    const mod = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/frozen-check.js`, "utf8");
    const load = mod.slice(mod.indexOf("function loadWarm()"), mod.indexOf("function stopWarm("));
    expect(load).toMatch(/void saveWarmState\(\)/);
    expect(load).not.toMatch(/await saveWarmState\(\)/);
    expect(mod).not.toMatch(/stays byte-for-byte 1\.17\.0/);
    expect(mod).toMatch(/one\s+(\/\/\s+)?LOCAL chrome\.storage write per worker start/);
    expect(mod).toMatch(/await loadWarm\(\);/);
  });
});

describe("round 4 — the load retry without a warm-up step, stopTriedAt in mem", () => {
  const MIN = 60 * S;
  const fire3s = (w: W) => { const t = w.calls.timers.filter((x) => x.ms === 3000); for (const x of t) x.fn(); w.calls.timers = w.calls.timers.filter((x) => x.ms !== 3000); return t.length; };
  // a stale popup line from the last run (on:true, "9 checked") + its restart memory
  const SAVED = (t: number) => ({ on: true, checked: 9, left: 3, lastAt: t - 10 * MIN, mem: { lastAt: t - 10 * MIN, pauseUntil: 0, misses: 1, pauses: 1, stopped: false, stopReason: "", stopWritten: false, sawOffSinceStop: false, queueAt: t - 1 * MIN, queue: ["600001"] } });
  const loaded = (w: W) => (w.evalIn("pcFrozenKick.__test.warm") as { loaded: boolean }).loaded;
  it("1: boot read fails, frozen switch OFF → the next pass reads again (not awaited) and writes {on:false} to the popup line", async () => {
    const saved = SAVED(T0);
    const { w, clock } = await boot({ frozenSwitch: "false", holdStorageGet: "pc_frozen_warmup", initialStorage: { pc_frozen_warmup: JSON.parse(JSON.stringify(saved)) }, warmupSwitch: "true", warmupNext: storeList(20, new Set()) });
    expect(w.calls.heldGets).toHaveLength(1);
    fire3s(w); await flush();                                                // the boot read times out
    expect(loaded(w)).toBe(false);
    expect(w.storage.pc_frozen_warmup).toEqual(saved);                       // the stale line is still there
    for (let i = 0; i < 6 && w.calls.heldGets.length < 2; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(w.calls.heldGets).toHaveLength(2);                                // retried — no warm-up step ran (switch off)
    w.calls.heldGets[1].release(); await flush();
    expect(loaded(w)).toBe(true);
    expect(shown(w)).toEqual({ on: false });                                 // the stale "on / 9 checked" line is gone
    expect(memOf(w)).toMatchObject({ pauses: 1, misses: 1 });                // the saved memory came through
    expect(count(w, /admin_frozen_warmup_/)).toBe(0);
    expect(warmMsgs(w)).toEqual([]);
  });
  it("1: boot read fails, frozen switch ON but the frozen queue never empties → retried too; real parcels keep going out", async () => {
    const saved = SAVED(T0);
    const opts: Opts = { holdStorageGet: "pc_frozen_warmup", initialStorage: { pc_frozen_warmup: JSON.parse(JSON.stringify(saved)) }, warmupSwitch: "true", warmupNext: storeList(20, new Set()),
      frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }, { id: "fz-2", store_id: "151003", queue_depth: 1 }], frozenVerdict: () => "unknown" };
    const { w, clock } = await boot(opts);
    fire3s(w); await flush();
    for (let i = 0; i < 6 && w.calls.heldGets.length < 2; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(w.calls.heldGets).toHaveLength(2);
    w.calls.heldGets[1].release(); await flush();
    expect(loaded(w)).toBe(true);
    await ticks(w, clock, 12);
    expect(w.storage.pc_frozen_warmup).not.toEqual(saved);                   // the line was rewritten from the loaded state
    expect(memOf(w)).toMatchObject({ pauses: 1, misses: 1 });
    expect(liveFrozenMsgs(w).length).toBeGreaterThan(0);                    // the real frozen parcels never waited
    expect(warmMsgs(w)).toEqual([]);                                         // a frozen parcel waiting → no warm-up
  });
  it("1: source pin — the retry is `void loadWarm()` (never awaited) and sits OUTSIDE the switch/tab block", async () => {
    const { readFileSync } = await import("node:fs");
    const mod = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/frozen-check.js`, "utf8");
    const pass = mod.slice(mod.indexOf("async function runPass("), mod.indexOf("async function sendOne("));
    expect(pass).toMatch(/if \(!warm\.loaded\) void loadWarm\(\);/);
    expect(pass).toMatch(/await loadWarm\(\);\s*\/\/[^\n]*\n\s*await warmOne\(/);   // the awaited one stays right before warmOne
    const block = pass.slice(pass.indexOf("if (st.switchOn && tabId"), pass.indexOf("// (3) refresh"));
    expect(block.indexOf("void loadWarm()")).toBeGreaterThan(block.lastIndexOf("}\n    }\n"));
  });
  it("2: stopTriedAt survives a restart (in mem) and a future value is clamped to now", async () => {
    const done = new Set<string>();
    // a stop whose write failed: stopTriedAt saved in mem
    const a = await boot({ warmupSwitch: "true", warmupStopHttp: 500, warmupNext: storeList(50, done), frozenReply: () => ({ frozen_store_status: "unknown", frozen_reason: "HTTP 429", blocked: true }) });
    await ticks(a.w, a.clock, 12);
    expect(memOf(a.w)).toMatchObject({ stopped: true, stopWritten: false });
    expect(Number(memOf(a.w).stopTriedAt)).toBeGreaterThan(0);
    expect(Number(memOf(a.w).stopTriedAt)).toBeLessThanOrEqual(a.clock.t);
    // a corrupted / future stopTriedAt → clamped to now → the retry is at most the normal 60 s away
    const far = T0 + 10 * 24 * 60 * MIN;
    const b = await boot({ warmupSwitch: "true", warmupNext: storeList(50, done),
      initialStorage: { pc_frozen_warmup: { on: false, mem: { ...memOf(a.w), stopTriedAt: far } } } });
    expect((b.w.evalIn("pcFrozenKick.__test.warm") as { stopTriedAt: number }).stopTriedAt).toBe(T0);
    await ticks(b.w, b.clock, 16);                                           // 80 s
    expect(bodiesOf(b.w, /admin_frozen_warmup_stop/).map((x) => x.p_reason)).toContain("HTTP 429");
  });
});

describe("night (01:00–05:00 Taipei) — warm-up may probe behind the real parcels (1.18.2: the live lane runs too)", () => {
  const MIN = 60 * S;
  const TN = Date.UTC(2026, 0, 15, 17, 30, 0); // 01:30 Taipei
  async function nightBoot(opts: Opts) {
    const clock = { t: TN };
    const defaults: Opts = { rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [], maintenance: true };
    for (const [k, v] of Object.entries(defaults)) if (!(k in opts)) (opts as Record<string, unknown>)[k] = v;
    opts.now = () => clock.t;
    const w = bootWorker(opts);
    await w.booted;
    return { w, clock };
  }
  // what emap-frozen-711.js answers for an E-Map maintenance page (200 body or a redirect)
  const MAINT = { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx maintenance page", transient: true, blocked: false, maintenance: true };
  it("night probe → real verdict → the normal 60 s pace (verdicts written); 1.18.2: a waiting frozen parcel goes FIRST, live, then the warm-up", async () => {
    const done = new Set<string>(); const at: number[] = []; const ref = { t: 0 }; const order: string[] = [];
    let live = true;                                                        // the real parcel waits until its verdict is written
    const { w, clock } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, done), frozenPending: () => (live ? [{ id: "fz-1", store_id: "968551", queue_depth: 1 }] : []),
      frozenReply: (row) => {
        order.push(String(row?.id));
        if (row?.id === "fz-1") { live = false; return { frozen_store_status: "no_frozen", frozen_reason: "", transient: false }; }
        at.push(ref.t); done.add(String(row?.store_id)); return { frozen_store_status: "no_frozen", frozen_reason: "", transient: false };
      } });
    for (let i = 0; i < 12 * 10; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(order[0]).toBe("fz-1");                                          // the real parcel first, before any warm-up probe
    expect(order.filter((x) => x === "fz-1")).toHaveLength(1);
    expect(liveFrozenMsgs(w).every((m) => m.night === true)).toBe(true);
    expect(w.calls.logs).toContain("[PC-FROZEN] night send store=968551 row=fz-1 result=no_frozen");
    expect(at.length).toBeGreaterThanOrEqual(7);                            // then ~1 per minute
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(60 * S);
    expect(bodiesOf(w, /admin_frozen_warmup_verdict/).length).toBe(at.length);
    expect(count(w, /admin_parcel_frozen_pending/)).toBeGreaterThan(0);
    expect(w.calls.logs.some((l) => /\[PC-WARMUP\] warm-up store=600001 → no_frozen/.test(l))).toBe(true);
  });
  it("1.18.2: at night a waiting frozen parcel holds the warm-up back, exactly like by day (no probe while it is pending)", async () => {
    const done = new Set<string>();
    // a warm-up store list is already in hand (saved before a restart) → only the send gate stands between
    // the waiting real parcel and a warm-up probe (the list-read gate is not needed to hold it back)
    const { w, clock } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, done), frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }],
      initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: 0, queueAt: TN, pauseUntil: 0, misses: 0, pauses: 0, stopped: false, queue: ["600001", "600002", "600003", "600004", "600005"] } } },
      frozenReply: () => null });                                           // the live check never gets an answer → it stays pending
    expect((w.evalIn("pcFrozenKick.__test.warm") as { queue: string[] }).queue).toHaveLength(5);
    for (let i = 0; i < 12 * 25; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(warmMsgs(w)).toEqual([]);
    expect(count(w, /admin_frozen_warmup_next/)).toBe(0);
    expect(liveFrozenMsgs(w).length).toBeGreaterThanOrEqual(2);             // retried every 10 min, never counted
  });
  for (const [name, reply] of [["a maintenance page", MAINT], ["no answer (timeout)", null], ["an empty / odd page", { frozen_store_status: "unknown", frozen_reason: '/ecmap/byIDData.aspx unexpected response: ""', transient: false, blocked: false }]] as const) {
    it(`night ${name} → nothing written, next probe 10 min later, never a miss / pause / stop`, async () => {
      const done = new Set<string>(); const at: number[] = []; const ref = { t: 0 };
      const { w, clock } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: () => { at.push(ref.t); return reply as never; } });
      for (let i = 0; i < 12 * 65; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; }  // 65 min
      expect(at.length).toBeGreaterThanOrEqual(6);
      expect(at.length).toBeLessThanOrEqual(7);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(10 * MIN);
      expect(count(w, /admin_frozen_warmup_verdict/)).toBe(0);              // nothing written
      expect(count(w, /admin_frozen_warmup_stop/)).toBe(0);                 // never stopped (by day: pause at 3, stop at 6)
      expect(memOf(w)).toMatchObject({ misses: 0, pauses: 0, stopped: false, pauseUntil: 0 });
      expect(Number(memOf(w).nightRetryAt)).toBeGreaterThan(clock.t - 10 * MIN);
      expect(w.calls.logs.some((l) => /no answer at night .* nothing written, not counted, next probe in 10 min/.test(l))).toBe(true);
    });
  }
  it("night: a no-answer, then a real answer → back to the 60 s pace at once", async () => {
    const done = new Set<string>(); const at: number[] = []; const ref = { t: 0 }; let n = 0;
    const { w, clock } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, done),
      frozenReply: (row) => { at.push(ref.t); n += 1; if (n === 1) return MAINT as never; done.add(String(row?.store_id)); return { frozen_store_status: "ok" }; } });
    for (let i = 0; i < 12 * 16; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(at.length).toBeGreaterThanOrEqual(5);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(10 * MIN);                 // the night retry
    for (let i = 2; i < at.length; i++) expect(at[i] - at[i - 1]).toBeLessThan(2 * MIN); // then the normal pace
    expect(Number(memOf(w).nightRetryAt)).toBe(0);
  });
  for (const [name, reply] of [["captcha", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx unexpected response: \"captcha\"", blocked: true }], ["HTTP 403", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx returned HTTP 403", blocked: true }], ["HTTP 429", { frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx returned HTTP 429", blocked: true }]] as const) {
    it(`night ${name} → STOP, exactly like by day`, async () => {
      const { w, clock } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => reply as never });
      await ticks(w, clock, 24);
      expect(warmMsgs(w)).toHaveLength(1);
      expect(bodiesOf(w, /admin_frozen_warmup_stop/)).toHaveLength(1);
      expect(count(w, /admin_frozen_warmup_verdict/)).toBe(0);
      expect(memOf(w)).toMatchObject({ stopped: true });
    });
  }
  it("a night no-answer does not leak into the day: at 05:00 the day rules (misses → pause) apply again", async () => {
    const at: number[] = []; const ref = { t: 0 };
    const clock = { t: Date.UTC(2026, 0, 15, 20, 55, 0) };                   // 04:55 Taipei
    const opts: Opts = { now: () => clock.t, rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [], maintenance: true, warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => { at.push(ref.t); return null as never; } };
    const w = bootWorker(opts); await w.booted;
    for (let i = 0; i < 12 * 12; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; }  // 04:55 → 05:07
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(at[0]).toBeLessThan(Date.UTC(2026, 0, 15, 21, 0, 0));            // the night probe
    expect(at[at.length - 1]).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 15, 21, 0, 0)); // a day probe
    expect(at[1] - at[0]).toBeLessThan(10 * MIN);                           // the night 10-min wait does not carry into the day
    expect(memOf(w)).toMatchObject({ pauses: 1 });                          // by day the no-answers count again: 3 → the 30-min pause
    expect(w.calls.logs.some((l) => /miss 1\/3/.test(l))).toBe(true);
  });
  it("nightRetryAt survives a restart; a future value is clamped to the window's end (05:00) at night", async () => {
    const { w } = await nightBoot({ warmupSwitch: "true", warmupNext: storeList(50, new Set()),
      initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: 0, queueAt: 0, pauseUntil: 0, misses: 0, pauses: 0, stopped: false, queue: [], nightRetryAt: TN + 10 * 24 * 60 * MIN, nightMisses: 4 } } } });
    const m = w.evalIn("pcFrozenKick.__test.warm") as { nightRetryAt: number; nightMisses: number };
    expect(m.nightRetryAt).toBe(Date.UTC(2026, 0, 15, 21, 0, 0));            // 05:00 Taipei
    expect(m.nightMisses).toBe(4);
  });
  it("dry work first at night too: a dry parcel pending → no night probe", async () => {
    const { w, clock } = await nightBoot({ rows: undefined, warmupSwitch: "true", warmupNext: storeList(20, new Set()) });
    await ticks(w, clock, 60);
    expect(warmMsgs(w)).toEqual([]);
  });
});

describe("round 5 — night flag, 6 night no-answers → wait till 05:00, edge resets, guards", () => {
  const MIN = 60 * S;
  const T0100 = Date.UTC(2026, 0, 14, 17, 0, 0);   // 01:00 Taipei (Jan 15)
  const T0500 = Date.UTC(2026, 0, 14, 21, 0, 0);   // 05:00 Taipei (Jan 15)
  const OK_REPLY = { frozen_store_status: "ok", frozen_reason: "", transient: false };
  async function at(t: number, opts: Opts) {
    const clock = { t };
    const defaults: Opts = { rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [], maintenance: true };
    for (const [k, v] of Object.entries(defaults)) if (!(k in opts)) (opts as Record<string, unknown>)[k] = v;
    opts.now = () => clock.t;
    const w = bootWorker(opts); await w.booted;
    return { w, clock };
  }
  const warmObj = (w: W) => w.evalIn("pcFrozenKick.__test.warm") as Record<string, number | boolean | null>;
  it("1: the night probe carries nightWarm: true; the day warm-up and the live frozen lane never do", async () => {
    const done = new Set<string>();
    const reply = (row?: { id?: string; store_id?: string }) => { done.add(String(row?.store_id)); return OK_REPLY; };
    const n = await at(T0100 + 30 * MIN, { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: reply });
    await ticks(n.w, n.clock, 24);
    expect(warmMsgs(n.w).length).toBeGreaterThan(0);
    expect(warmMsgs(n.w).every((m) => m.nightWarm === true)).toBe(true);
    const d = await at(T0, { warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => OK_REPLY,
      frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }] });
    await ticks(d.w, d.clock, 24);
    expect(liveFrozenMsgs(d.w).length).toBeGreaterThan(0);
    expect(d.w.calls.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK").every((m) => m.nightWarm === undefined)).toBe(true);
    const day = await at(T0, { warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => OK_REPLY });
    await ticks(day.w, day.clock, 24);
    expect(warmMsgs(day.w).length).toBeGreaterThan(0);
    expect(warmMsgs(day.w).every((m) => m.nightWarm === undefined)).toBe(true);
  });
  it("4: 6 night no-answers in a row → no more probes until 05:00 (nothing written, never a stop); after 05:00 the day rules apply", async () => {
    const at0: number[] = []; const ref = { t: 0 };
    const { w, clock } = await at(T0100 + 5 * MIN, { warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => { at0.push(ref.t); return null as never; } });
    for (let i = 0; i < 12 * 60 * 4; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; if (clock.t >= T0500 - 10 * S) break; } // 01:05 → 04:59:50
    const night = at0.filter((t) => t < T0500);
    expect(night).toHaveLength(6);                                          // 10 min apart, then silence
    for (let i = 1; i < night.length; i++) expect(night[i] - night[i - 1]).toBeGreaterThanOrEqual(10 * MIN);
    expect(night[5] - night[0]).toBeLessThan(60 * MIN);
    expect(Number(warmObj(w).nightRetryAt)).toBe(T0500);
    expect(count(w, /admin_frozen_warmup_verdict/)).toBe(0);
    expect(count(w, /admin_frozen_warmup_stop/)).toBe(0);
    expect(w.calls.logs.some((l) => /6 in a row, no more probes until 05:00/.test(l))).toBe(true);
    for (let i = 0; i < 12 * 3; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; } // past 05:00
    expect(at0.some((t) => t >= T0500)).toBe(true);                       // the day warm-up probes again
  });
  it("4: a real answer in between resets the night count (5 misses, an answer, then 6 more misses before the wait)", async () => {
    const at0: number[] = []; const ref = { t: 0 }; let n = 0;
    const { w, clock } = await at(T0100 + 5 * MIN, { warmupSwitch: "true", warmupNext: storeList(80, new Set()),
      frozenReply: () => { at0.push(ref.t); n += 1; return (n === 6 ? OK_REPLY : null) as never; } });
    for (let i = 0; i < 12 * 60 * 3; i++) { ref.t = clock.t; await w.sb.pcTick(); await flush(); clock.t += 5 * S; } // 01:05 → 04:05
    expect(at0).toHaveLength(12);                                           // 5 misses + the answer + 6 misses, then silence
    expect(at0[6] - at0[5]).toBeLessThan(2 * MIN);                           // after the answer: the 60 s pace, not 10 min
    expect(Number(warmObj(w).nightRetryAt)).toBe(T0500);
  });
  it("5: warm.misses is reset at the 01:00 edge and at the 05:00 edge", async () => {
    const { w, clock } = await at(T0100 - 2 * MIN, { warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => null as never });
    for (let i = 0; i < 12 * 2 + 1 && clock.t < T0100; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; }
    expect(Number(warmObj(w).misses)).toBeGreaterThan(0);                  // day misses at 00:58–00:59
    await w.sb.pcTick(); await flush();                                     // first pass at 01:00
    expect(Number(warmObj(w).misses)).toBe(0);
    expect(w.calls.logs.some((l) => /maintenance window started \(01:00\) — no-answer count reset/.test(l))).toBe(true);
    // 05:00: a day miss count left in mem at 04:59 (e.g. restored after a restart) is cleared at the edge
    const late = await at(T0500 - 30 * S, { warmupSwitch: "true", warmupNext: storeList(50, new Set()), frozenReply: () => null as never,
      initialStorage: { pc_frozen_warmup: { on: false, mem: { lastAt: 0, queueAt: 0, pauseUntil: 0, misses: 2, pauses: 0, stopped: false, queue: [], lastNight: true } } } });
    for (let i = 0; i < 4 && late.clock.t < T0500; i++) { await late.w.sb.pcTick(); await flush(); late.clock.t += 5 * S; }
    expect(Number(warmObj(late.w).misses)).toBe(2);                        // still night: untouched
    late.clock.t = T0500 + 1 * S;
    await late.w.sb.pcTick(); await flush();
    expect(Number(warmObj(late.w).misses)).toBeLessThanOrEqual(1);         // reset at 05:00 (a probe in that pass may add 1)
    expect(late.w.calls.logs.some((l) => /maintenance window ended \(05:00\) — no-answer count reset/.test(l))).toBe(true);
  });
  it("6a: night, the warm-up list already loaded, then a dry row appears → no warm-up request while it waits", async () => {
    const done = new Set<string>();
    const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => { done.add(String(row?.store_id)); return OK_REPLY; } };
    const { w, clock } = await at(T0100 + 30 * MIN, opts);
    await ticks(w, clock, 24);                                              // 2 min idle at night
    const before = warmMsgs(w).length;
    expect(before).toBeGreaterThan(0);
    expect((warmObj(w).queue as unknown as string[]).length).toBeGreaterThan(0); // stores still queued = the list is loaded
    opts.rows = [{ id: "dry-9", phone: "0912345678", store_id: "195965", gm_id: "GM1", sender_phone: "0979593026", need_phone: true, need_store: true, queue_depth: 1, created_at: new Date(clock.t).toISOString() }];
    await ticks(w, clock, 36);                                              // 3 min with a dry row waiting
    expect(warmMsgs(w).length).toBe(before);
  });
  for (const [name, edge, startNight] of [["04:59:59.5 → 05:00", T0500, true], ["00:59:59.5 → 01:00", T0100, false]] as const) {
    it(`6b: kick at ${name} before the send → no warm-up request in that pass`, async () => {
      const done = new Set<string>();
      let jump = false, pings = 0;
      let clockRef = { t: 0 };
      const opts: Opts = { warmupSwitch: "true", warmupNext: storeList(50, done), frozenReply: (row) => { done.add(String(row?.store_id)); return OK_REPLY; },
        onFrozenPing: () => { if (jump) { pings += 1; clockRef.t = edge + 100; } } };
      // 4 min lead-in: lands on edge − 0.5 s, and the 5-min E-Map keepalive (boot + 5 min) is NOT in the kick's pass
      const { w, clock } = await at(edge - 240_500, opts);
      clockRef = clock;
      for (let i = 0; i < 48; i++) { await w.sb.pcTick(); await flush(); clockRef.t += 5 * S; }
      expect(clockRef.t).toBe(edge - 500);
      expect(warmMsgs(w).length).toBeGreaterThan(0);                         // the warm-up was running before
      expect(Boolean(w.evalIn("pcInMaintenance(Date.now())"))).toBe(startNight);
      const wo = warmObj(w); wo.lastAt = 0;                                  // the 60 s pace is satisfied at the kick
      w.evalIn('pcFrozenKick.__test.warm.queue = ["699001"]');              // a store is waiting (the list may be used up)
      w.evalIn("pcFrozenKick.__test.state.emptyUntil = Date.now() + 60000"); // day gate: a fresh "no frozen parcels" read (night ignores it)
      const before = warmMsgs(w).length;
      jump = true;
      await w.sb.pcTick(); await flush();
      jump = false;
      expect(pings).toBeGreaterThan(0);                                      // the pass reached the send step (not vacuous)
      expect(clockRef.t).toBe(edge + 100);
      expect(warmMsgs(w).length).toBe(before);                               // the window flipped meanwhile → no request
    });
  }
});
