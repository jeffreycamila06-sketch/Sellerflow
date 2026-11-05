// 1.17.0 — the FROZEN (冷凍) store-check lane (chrome-extension/frozen-check.js) under the real
// worker (background.js + importScripts) in the vm harness. Jeff's hard rules, each pinned:
//   • ADD ONLY — background.js differs from main by exactly two ADDED lines (the guarded import +
//     the kick); the only other extension changes are the two new files and the manifest; the
//     module shares NO top-level name with background.js and adds exactly ONE global.
//   • switch OFF = byte-for-byte today's requests / DB writes / tab messages, compared against
//     MAIN's background.js run under the same harness. The ONE allowed difference: a read-only
//     GET of the switch row (≤ 1 per minute).
//   • the frozen request goes out ONLY right at the kick (rows read in an earlier pass; switch /
//     rows refreshed after it), at most ONE per pass, only with no other pass running and no
//     normal row / keepalive near — realistic-timing proof in parcelCheckerSim.test.ts.
//   • error isolation, 3 s cap, per-row leader / window re-check, injection ≤ 1 per tab per
//     10 min, no pending read for 60 s after an empty one.
// The tests drive the loop through pcTick, exactly as production does (pcTimer is consumed at
// the start of a pass and re-armed at its end).
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000, MIN = 60 * S;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei, outside the maintenance window (in the past, so the harness's fake JWT is valid)
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "test", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const FROZEN_ROWS = [
  { id: "fz-1", store_id: "968551", created_at: new Date(T0 - 60 * S).toISOString(), queue_depth: 3 },
  { id: "fz-2", store_id: "968551", created_at: new Date(T0 - 50 * S).toISOString(), queue_depth: 3 }, // same store as fz-1 → not picked with it
  { id: "fz-3", store_id: "151003", created_at: new Date(T0 - 40 * S).toISOString(), queue_depth: 3 },
];
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
type W = ReturnType<typeof bootWorker>;
type Calls = W["calls"];
// The only legitimate difference between two boots is the random worker id — normalised.
const wid = (w: W): string => String((w.storage.pc_worker as { id?: string } | undefined)?.id ?? "");
const norm = (w: W, s: string): string => (wid(w) ? s.split(wid(w)).join("WID") : s);
const trace = (w: W) => ({
  fetch: w.calls.fetch.map((u, i) => [u, norm(w, w.calls.fetchBodies[i])]),
  msgs: w.calls.sendMessage.map((m) => `${m.type}:${m.tabId}:${m.rowId ?? ""}`),
});
const SWITCH_GET = /rest\/v1\/app_settings\?select=key,value&key=eq\.frozen_store_check_enabled$/;
const frozenFetches = (c: Calls) => c.fetch.filter((u) => /admin_parcel_frozen_/.test(u));
const pendingReads = (c: Calls) => c.fetch.filter((u) => /admin_parcel_frozen_pending/.test(u)).length;
const frozenMsgs = (c: Calls) => c.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK");
const verdictBodies = (c: Calls) => c.fetch.map((u, i) => [u, c.fetchBodies[i]] as const).filter(([u]) => /admin_parcel_frozen_verdict/.test(u)).map(([, b]) => JSON.parse(b) as { p_id: string; p_expected_store: string; p_status: string });
const normalLane = (w: W) => ({
  fetch: w.calls.fetch.map((u, i) => [u, norm(w, w.calls.fetchBodies[i])]).filter(([u]) => !SWITCH_GET.test(u) && !/admin_parcel_frozen_/.test(u)),
  msgs: w.calls.sendMessage.filter((m) => m.type !== "PC_FROZEN_CHECK" && m.type !== "PC_FROZEN_PING").map((m) => `${m.type}:${m.tabId}:${m.rowId ?? ""}`),
});

let mainDir = "";
let mainRef = "origin/main";
beforeAll(() => {
  mainDir = join(tmpdir(), `sfl-main-ext-${process.pid}`);
  mkdirSync(mainDir, { recursive: true });
  try { execSync("git rev-parse --verify --quiet origin/main", { stdio: "pipe" }); } catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); mainRef = "FETCH_HEAD"; }
  writeFileSync(join(mainDir, "background.js"), execSync(`git show ${mainRef}:chrome-extension/background.js`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
});

// One pass = one pcTick (as the loop runs it), then 5 s on the clock.
async function tick(w: W, clock: { t: number }, n = 1) { for (let i = 0; i < n; i++) { await w.sb.pcTick(); await flush(); clock.t += 5 * S; } }
async function run(opts: Opts, ticks = 3) {
  const clock = { t: T0 };
  const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, ...opts });
  await w.booted;
  await tick(w, clock, ticks);
  return { w, clock };
}

// ── ADD ONLY ───────────────────────────────────────────────────────────────────
describe("ADD ONLY — the two guarded lines, and the module's footprint", () => {
  it("background.js carries the two guarded lines (the import + the kick), each exactly once — the kick inside pcRunOnce, after the normal lane's rows (now merged, so this no longer diffs against main)", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    const lines = bg.split("\n").map((l) => l.trim());
    const imp = lines.filter((l) => /^try \{ importScripts\("frozen-check\.js"\); \} catch \(e\) \{ console\.log\(`\[PC-FROZEN\] module not loaded: /.test(l));
    const kick = lines.filter((l) => /^try \{ if \(typeof pcFrozenKick === "function"\) pcFrozenKick\(pass\); \} catch \(e\) \{/.test(l));
    expect(imp).toHaveLength(1);
    expect(kick).toHaveLength(1);
    const run = bg.slice(bg.indexOf("async function pcRunOnce("), bg.indexOf("\n}\n", bg.indexOf("async function pcRunOnce(")));
    expect(run).toContain("pcFrozenKick(pass)");
    expect(run.indexOf("pcFrozenKick(pass)")).toBeGreaterThan(run.indexOf("pcPollMulti("));
  });
  it("C. frozen-check.js is ONE function scope: no top-level name shared with background.js (parsed), and loading it adds exactly ONE global — pcFrozenKick", () => {
    const names = (file: string) => {
      const sf = ts.createSourceFile(file, readFileSync(`chrome-extension/${file}`, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
      const out: string[] = [];
      const bind = (n: ts.BindingName) => { if (ts.isIdentifier(n)) out.push(n.text); else for (const e of n.elements) if (!ts.isOmittedExpression(e)) bind(e.name); };
      for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bind(d.name);
        else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.push(st.name.text);
      }
      return { out, count: sf.statements.length };
    };
    const bg = names("background.js"), fz = names("frozen-check.js");
    expect(bg.out.length).toBeGreaterThan(100);    // the parse really saw background.js's top level
    expect(fz.out).toEqual([]);                    // the module declares nothing at the top level…
    expect(fz.count).toBe(1);                      // …it is a single statement (the IIFE)
    expect(bg.out.filter((n) => fz.out.includes(n))).toEqual([]);
    const ctx: Record<string, unknown> = {};
    vm.createContext(ctx);
    const before = new Set(vm.runInContext("Object.getOwnPropertyNames(globalThis)", ctx) as string[]);
    vm.runInContext(readFileSync("chrome-extension/frozen-check.js", "utf8"), ctx);
    expect((vm.runInContext("Object.getOwnPropertyNames(globalThis)", ctx) as string[]).filter((n) => !before.has(n))).toEqual(["pcFrozenKick"]);
  });
  it("the kick is the only call into the module, and the module never calls the normal lane's row flow nor assigns its state", () => {
    expect(readFileSync("chrome-extension/background.js", "utf8").split("pcFrozen").length - 1).toBe(2);
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); // code only, comments stripped
    expect(mod).not.toMatch(/pcPollMulti|pcPoll\(|pcEmapKeepalive\(|pcRefreshTabStatus|pcBackoff|pcScheduleLoop|pcTick\(|PC_CHECK_STORE|admin_parcel_check_verdict|admin_parcel_checks_pending/);
    expect(mod).not.toMatch(/\bpc(Timer|InFlight|LastKeepaliveAt|Lease|Ev)\s*=[^=]/);
  });
  it("a MISSING frozen-check.js, or one that throws at load, never stops the worker: it boots and the normal lane writes its verdict", async () => {
    for (const src of [null, 'throw new Error("boom at top level");'] as const) {
      const { w } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenModuleSrc: src }, 3);
      expect(w.calls.logs.some((l) => /\[PC-FROZEN\] module not loaded: /.test(l)), String(src)).toBe(true);
      expect(w.calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u)), `${src}: normal verdict`).toBe(true);
      expect(frozenMsgs(w.calls), String(src)).toEqual([]);
      expect(w.calls.logs.filter((l) => /\[PC-FROZEN\] skipped/.test(l)), String(src)).toEqual([]);
    }
  });
});

// ── switch OFF ─────────────────────────────────────────────────────────────────
describe("switch OFF = today's worker (compared to main)", () => {
  for (const frozenSwitch of ["missing", "false", "error"] as const) {
    it(`switch ${frozenSwitch}: every request, DB write and tab message equals main's, except one read-only GET of the switch row per minute`, async () => {
      const a = await run({ frozenSwitch, frozenPending: FROZEN_ROWS }, 4);
      const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 4);
      const ours = trace(a.w), theirs = trace(m.w);
      expect(ours.fetch.filter(([u]) => SWITCH_GET.test(u)), "the switch GET: once in 4 passes × 5 s").toHaveLength(1);
      expect(ours.fetch.filter(([u]) => !SWITCH_GET.test(u))).toEqual(theirs.fetch);
      expect(ours.msgs).toEqual(theirs.msgs);
      expect(frozenFetches(a.w.calls)).toEqual([]);
      expect(frozenMsgs(a.w.calls)).toEqual([]);
    });
  }
  it("the status/popup state the normal lane writes is identical with the module loaded (switch off)", async () => {
    const a = await run({ frozenSwitch: "false" }, 2);
    const m = await run({ extDir: mainDir }, 2);
    const scrub = (w: W) => JSON.parse(norm(w, JSON.stringify(w.status()))) as unknown;
    expect(scrub(a.w)).toEqual(scrub(m.w));
  });
});

// ── switch ON ──────────────────────────────────────────────────────────────────
describe("switch ON — the frozen lane", () => {
  it("pass 1 only READS (switch + rows, no E-Map request); then ONE frozen request per pass, cate=27 via its own message + its own verdict RPC; the NORMAL lane equals main's", async () => {
    const verdicts: Record<string, string> = { "968551": "no_frozen", "151003": "ok" };
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => verdicts[row?.store_id ?? ""] ?? "unknown" }, 1);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(pendingReads(w.calls)).toBe(1);
    expect(w.calls.fetchBodies[w.calls.fetch.findIndex((u) => /admin_parcel_frozen_pending/.test(u))]).toBe('{"p_limit":3}');
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3"]); // fz-2 shares fz-1's store
    expect(verdictBodies(w.calls)).toEqual([
      { p_id: "fz-1", p_expected_store: "968551", p_status: "no_frozen" },
      { p_id: "fz-3", p_expected_store: "151003", p_status: "ok" },
    ]);
    expect(frozenMsgs(w.calls).every((m) => m.tabId === 3)).toBe(true);
    const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 3);
    expect(normalLane(w)).toEqual(trace(m.w));
    expect(w.calls.logs.filter((l) => /\[PC-FROZEN\] row=/.test(l))).toEqual(["[PC-FROZEN] row=fz-1 store=968551 → no_frozen", "[PC-FROZEN] row=fz-3 store=151003 → ok"]);
  });
  it("A. at most ONE frozen request per pass also with no dry rows; nothing while the keepalive was sent < 25 s ago or is due within 20 s", async () => {
    const rows = [{ id: "fz-a", store_id: "111111" }, { id: "fz-b", store_id: "222222" }, { id: "fz-c", store_id: "333333" }];
    const { w, clock } = await run({ rows: [], frozenSwitch: "true", frozenPending: rows }, 1);
    expect(w.calls.logs.some((l) => /\[PC-KEEPALIVE\]/.test(l))).toBe(true);   // pass 1 sent the keepalive (after the kick)
    const sent: number[] = [];
    for (let i = 0; i < 10; i++) { await tick(w, clock, 1); sent.push(frozenMsgs(w.calls).length); }
    expect(sent.slice(0, 4)).toEqual([0, 0, 0, 0]);                            // 5–20 s after the keepalive: wait
    expect(sent[sent.length - 1]).toBe(3);
    expect(sent.every((n, i) => n - (sent[i - 1] ?? 0) <= 1)).toBe(true);       // never two in one pass
    expect(w.calls.logs.some((l) => /normal lane busy \(keepalive just sent\) — next pass/.test(l))).toBe(true);
    // the keepalive due within 20 s → wait: move the clock to 20 s before the next keepalive
    const w2 = (await run({ rows: [], frozenSwitch: "true", frozenPending: rows }, 1)).w;
    const ka = Number(w2.evalIn("PC_KEEPALIVE_MS"));
    const c2 = { t: T0 + ka - 15 * S };
    const w3 = bootWorker({ now: () => c2.t, rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: rows });
    await w3.booted;
    w3.evalIn(`pcLastKeepaliveAt = ${T0};`);
    await tick(w3, c2, 2);
    expect(frozenMsgs(w3.calls)).toEqual([]);
    expect(w3.calls.logs.some((l) => /normal lane busy \(keepalive due\)/.test(l))).toBe(true);
  });
  it("D. an empty pending read → no pending read for 60 s; then one again (logged once)", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: [] }, 1);
    expect(pendingReads(w.calls)).toBe(1);
    await tick(w, clock, 11);                                                    // up to T0+55 s
    expect(pendingReads(w.calls)).toBe(1);
    await tick(w, clock, 1);                                                     // T0+60 s
    expect(pendingReads(w.calls)).toBe(2);
    expect(w.calls.logs.filter((l) => /no frozen parcels waiting/.test(l))).toHaveLength(1);
  });
  it("10-min floor per store: the same stores are not asked again within 10 min, even when the RPC keeps returning them; after 10 min they are", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 6);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3"]);
    clock.t += 10 * MIN;
    await tick(w, clock, 4);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3", "fz-1", "fz-3"]);
  });
  it("a real non-verdict answer (garbage / close / NO2, not transient) → that parcel is 'unknown', NO pause, the next pass checks the next one; the normal lane is untouched", async () => {
    const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => (row?.store_id === "968551" ? "garbage" : "ok") }, 3);
    const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 3);
    expect(normalLane(a.w)).toEqual(trace(m.w));
    expect(verdictBodies(a.w.calls).map((v) => `${v.p_id}:${v.p_status}`)).toEqual(["fz-1:unknown", "fz-3:ok"]);
    expect(a.w.calls.logs.some((l) => /paused 10 min/.test(l))).toBe(false);
  });
  for (const bad of ["throw", null, "timeout"] as const) {
    it(`1. ${String(bad) === "null" ? "no answer" : bad === "throw" ? "a failed tab message" : "the content script's 2.5 s timeout"} → that parcel is 'unknown' and the WHOLE frozen lane pauses 10 min (no request to any other store); then it resumes; the normal lane is main's`, async () => {
      const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => (row?.store_id === "968551" ? bad : "ok") }, 2);
      expect(verdictBodies(w.calls).map((v) => `${v.p_id}:${v.p_status}`)).toEqual(["fz-1:unknown"]);
      expect(w.calls.logs.some((l) => /\[PC-FROZEN\] E-Map slow or not answering \(.+\) — frozen checks paused 10 min/.test(l))).toBe(true);
      const pendingBefore = pendingReads(w.calls);
      await tick(w, clock, 20);                                                  // 100 s: another store is waiting, still nothing
      expect(frozenMsgs(w.calls)).toHaveLength(1);
      expect(pendingReads(w.calls)).toBe(pendingBefore);                         // no pending reads while paused either
      expect(w.calls.logs.some((l) => /paused after a slow \/ missing E-Map answer \(\d+ min left\) — next pass/.test(l))).toBe(true);
      clock.t += 9 * MIN;
      await tick(w, clock, 3);                                                   // pause over: read, then send
      expect(frozenMsgs(w.calls).map((m) => m.rowId).slice(0, 2)).toEqual(["fz-1", "fz-3"]); // the next store, once the pause is over
      const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 2);
      expect(normalLane(w).fetch.slice(0, trace(m.w).fetch.length)).toEqual(trace(m.w).fetch);
    });
  }
  it("a check that never answers → the 3 s cap writes 'unknown', frees the lane and pauses it 10 min", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => (row?.store_id === "968551" ? "hang" : "ok") }, 2);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    await tick(w, clock, 2);
    expect(frozenMsgs(w.calls)).toHaveLength(1);                               // still waiting → nothing new
    const cap = w.calls.timers.filter((t) => t.ms === 3 * S);
    expect(cap.length).toBeGreaterThan(0);
    cap[cap.length - 1].fn(); await flush();
    expect(verdictBodies(w.calls).map((v) => `${v.p_id}:${v.p_status}`)).toEqual(["fz-1:unknown"]);
    expect(w.calls.logs.some((l) => /frozen check timeout \(3s\)/.test(l))).toBe(true);
    expect((w.evalIn("pcFrozenKick.__test.state") as { busy: boolean }).busy).toBe(false);
    await tick(w, clock, 3);
    expect(frozenMsgs(w.calls)).toHaveLength(1);                               // paused
    clock.t += 10 * MIN;
    await tick(w, clock, 3);
    expect(frozenMsgs(w.calls).map((m) => m.rowId).slice(0, 2)).toEqual(["fz-1", "fz-3"]);
  });
  it("2. a whole pass that hangs is cut at 120 s: busy is released and the next pass runs", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: () => "hang" }, 2);
    expect(frozenMsgs(w.calls)).toHaveLength(1);
    const st = () => w.evalIn("pcFrozenKick.__test.state") as { busy: boolean };
    expect(st().busy).toBe(true);                                              // the 3 s cap is a recorded timer here, never fired
    const passCap = w.calls.timers.filter((t) => t.ms === 120 * S);
    expect(passCap.length).toBeGreaterThan(0);
    passCap[passCap.length - 1].fn(); await flush();
    expect(st().busy).toBe(false);
    expect(w.calls.logs.some((l) => /pass failed: frozen pass timeout \(120s\)/.test(l))).toBe(true);
    await tick(w, clock, 1);
    expect(st().busy).toBe(true);                                              // a new pass started
  });
  it("2. an injection that never returns is cut at 5 s (logged as failed); the lane is not left busy", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenScript: false }, 1);
    (w.sb.chrome.scripting as unknown as Record<string, unknown>).executeScript = () => { /* never calls back */ };
    await tick(w, clock, 1);
    const injCap = w.calls.timers.filter((t) => t.ms === 5 * S && t.fn !== w.sb.pcTick); // not the loop's own 5 s re-arm
    expect(injCap.length).toBeGreaterThan(0);
    injCap[injCap.length - 1].fn(); await flush();
    expect(w.calls.logs.some((l) => /emap-frozen-711\.js not answering on tab 3 → inject failed/.test(l))).toBe(true);
    expect((w.evalIn("pcFrozenKick.__test.state") as { busy: boolean }).busy).toBe(false);
    expect(frozenMsgs(w.calls)).toEqual([]);
  });
  it("2. kicks left behind pcEv.tick (a pass that never reached its kick) are resynced after 2 min — once, logged — so the lane never stays off", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 1);
    w.evalIn("pcEv.tick += 1;");                                                // a pass that will never kick
    await tick(w, clock, 20);                                                    // 100 s: still held back
    expect(frozenMsgs(w.calls)).toEqual([]);
    await tick(w, clock, 6);                                                     // past 2 min
    expect(w.calls.logs.filter((l) => /\[PC-FROZEN\] pass count 1 behind for 2 min — resynced/.test(l))).toHaveLength(1);
    expect(frozenMsgs(w.calls)[0]?.rowId).toBe("fz-1");
    const t = w.evalIn("pcFrozenKick.__test") as { resyncKicks: (n: number) => void; state: { kicks: number } };
    w.evalIn("pcFrozenKick.__test.state.kicks = pcEv.tick + 1;");              // a late kick after a resync overshoots…
    t.resyncKicks(clock.t);
    expect(t.state.kicks).toBe(Number(w.evalIn("pcEv.tick")));                 // …and clamps back at once
  });
  it("2. every await in frozen-check.js is bounded: each is withTimeout(…) or one of the module's own bounded steps; every body read has its own timeout", () => {
    const code = readFileSync("chrome-extension/frozen-check.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const awaits = [...code.matchAll(/await\s+([A-Za-z_.]+)\(/g)].map((m) => m[1]);
    expect(awaits.length).toBeGreaterThan(8);
    const ownSteps = ["withTimeout", "ensureScript", "alarmSoon", "readSwitch", "readPending", "sendOne", "ping"];
    expect(awaits.filter((a) => !ownSteps.includes(a))).toEqual([]);
    expect(code).not.toMatch(/await\s+r\.(json|text)\(/);                    // body reads go through withTimeout
    for (const what of ['"switch body")', '"pending body")', '"config read")', '"inject")', '"frozen pass")']) expect(code, what).toContain(what);
  });
  it("every frozen call is bounded: switch / pending / verdict 15 s, the check 3 s, the ping 1 s, the alarm read 0.5 s", () => {
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(mod).toMatch(/const CHECK_TIMEOUT_MS = 3 \* 1000;/);
    expect(mod).toMatch(/const DB_TIMEOUT_MS = 15 \* 1000;/);
    for (const what of ['"switch read")', '"pending read")', '"frozen check")', '"verdict write")', '"frozen ping")', '"alarm read")']) expect(mod, what).toContain(what);
  });
  it("a failing pending RPC (500) or verdict RPC (500) only logs; the normal lane is main's", async () => {
    const p = await run({ frozenSwitch: "true", frozenPending: "error" }, 3);
    expect(frozenMsgs(p.w.calls)).toEqual([]);
    expect(p.w.calls.logs.some((l) => /\[PC-FROZEN\] pending rpc_500/.test(l))).toBe(true);
    const v = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdictHttp: 500 }, 3);
    expect(v.w.calls.logs.filter((l) => /verdict rpc_500/.test(l))).toHaveLength(2);
    const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 3);
    expect(normalLane(p.w)).toEqual(trace(m.w));
    expect(normalLane(v.w)).toEqual(trace(m.w));
  });
  it("maintenance window (01:00–05:00 Taipei): no frozen request and no pending read", async () => {
    const clock = { t: Date.UTC(2026, 0, 15, 18, 30, 0) }; // 02:30 Taipei
    const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: FROZEN_ROWS });
    await w.booted; await tick(w, clock, 3);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(pendingReads(w.calls)).toBe(0);
  });
  it("standby (not the leader) → nothing frozen, not even the switch read", async () => {
    const standby: Opts["lease"] = () => ({ json: { leader: false, reason: "leader_alive", leader_id: "other", leader_label: "Mac", leader_age_s: 1, standby_ready: true, standby_age_s: 1, ttl_s: 120 } });
    const { w } = await run({ lease: standby, frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 3);
    expect(w.calls.fetch.filter((u) => SWITCH_GET.test(u) || /admin_parcel_frozen_/.test(u))).toEqual([]);
  });
  it("no E-Map tab → no pending read, no request, no 'unknown' stamped for our own missing tab", async () => {
    const { w } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, emapTab: false }, 3);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(verdictBodies(w.calls)).toEqual([]);
    expect(pendingReads(w.calls)).toBe(0);
  });
  it("paused / multi-seller off → nothing frozen", async () => {
    for (const o of [{ config: { paused: true } }, { multiSeller: false }] as Opts[]) {
      const { w } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, ...o }, 3);
      expect(w.calls.fetch.filter((u) => SWITCH_GET.test(u) || /admin_parcel_frozen_/.test(u)), JSON.stringify(o)).toEqual([]);
    }
  });
});

// ── guards right before the request ────────────────────────────────────────────
describe("guards right before the request", () => {
  it("the leader is re-checked right before the request", async () => {
    const clock = { t: T0 };
    const w: W = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, frozenSwitch: "true", frozenPending: FROZEN_ROWS, onFrozenPing: () => { w.evalIn('pcLease.role = "standby"; pcLease.leader = false;'); } });
    await w.booted; await tick(w, clock, 3);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.logs).toContain("[PC-FROZEN] lease lost — stopping");
  });
  it("the maintenance window is re-checked right before the request", async () => {
    const clock = { t: Date.UTC(2026, 0, 15, 16, 59, 40) };          // 00:59:40 Taipei
    const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: FROZEN_ROWS, onFrozenPing: () => { clock.t = Date.UTC(2026, 0, 15, 17, 0, 1); } });
    await w.booted;
    await w.sb.pcTick(); await flush(); clock.t += 5 * S;              // pass 1: reads
    await w.sb.pcTick(); await flush();                                // pass 2: the ping crosses 01:00
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.logs).toContain("[PC-FROZEN] maintenance window started — stopping");
  });
  it("another pass running (started but not kicked yet, or the loop already re-armed by another pass at kick time) → no request", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 1);
    w.evalIn("pcEv.tick += 1;");                                     // a pass started that has not reached its kick
    await tick(w, clock, 2);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.logs.some((l) => /other pass\(es\) before their row checks — next pass/.test(l))).toBe(true);
    w.evalIn("pcFrozenKick.__test.state.kicks = pcEv.tick;");        // that pass kicked meanwhile
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    w.evalIn("pcTimer = 7;");                                        // re-armed by ANOTHER pass when ours kicks
    clock.t += 65 * S;                                               // past the once-a-minute log throttle
    await w.sb.pcRunOnce(); await flush();
    expect(frozenMsgs(w.calls)).toHaveLength(1);
    expect(w.calls.logs.some((l) => /another pass already re-armed the loop — next pass/.test(l))).toBe(true);
  });
  it("the keepalive alarm due within 4 s → no request; later → sent", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 1);
    let next = 0;
    (w.sb.chrome.alarms as unknown as Record<string, unknown>).get = (_n: string, cb: (a: { scheduledTime: number }) => void) => cb({ scheduledTime: next });
    next = clock.t + 2 * S;
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.logs.some((l) => /keepalive alarm due — next pass/.test(l))).toBe(true);
    next = clock.t + 20 * S;
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
  });
  it("a normal row in flight at the kick → no request", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 1);
    w.evalIn('pcInFlight.add("someone-elses-row");');
    await tick(w, clock, 2);
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.logs.some((l) => /normal lane busy \(row in flight\)/.test(l))).toBe(true);
    w.evalIn("pcInFlight.clear();");
    await tick(w, clock, 1);
    expect(frozenMsgs(w.calls)).toHaveLength(1);
  });
});

// ── B · self-heal + injection limit ────────────────────────────────────────────
describe("B · self-heal and the injection limit", () => {
  it("no answer from the frozen content script → it is injected into the E-Map tab and the check proceeds", async () => {
    const { w } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS.slice(0, 1), frozenScript: false }, 2);
    expect(w.calls.injected.filter((f) => f === "emap-frozen-711.js")).toEqual(["emap-frozen-711.js"]);
    expect(w.calls.logs.some((l) => /emap-frozen-711\.js not answering on tab 3 → injected/.test(l))).toBe(true);
    expect(verdictBodies(w.calls).map((v) => v.p_status)).toEqual(["ok"]);
  });
  it("still silent after an injection → at most ONE injection per tab per 10 minutes (no loop), then one more", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenScriptNever: true }, 20); // 100 s
    expect(w.calls.injected.filter((f) => f === "emap-frozen-711.js")).toHaveLength(1);
    expect(frozenMsgs(w.calls)).toEqual([]);
    clock.t += 10 * MIN;
    await tick(w, clock, 3);
    expect(w.calls.injected.filter((f) => f === "emap-frozen-711.js")).toHaveLength(2);
  });
});

// ── pure helpers ───────────────────────────────────────────────────────────────
describe("pure helpers", () => {
  const helpers = () => bootWorker({ lease: LEADER }).evalIn("pcFrozenKick.__test") as Record<string, (...a: unknown[]) => unknown>;
  it("switchValue: only the exact key + 'true'", () => {
    const t = helpers();
    expect(t.switchValue([{ key: "frozen_store_check_enabled", value: "true" }])).toBe(true);
    for (const v of ["TRUE", "yes", "1", " true", ""]) expect(t.switchValue([{ key: "frozen_store_check_enabled", value: v }]), v).toBe(false);
    expect(t.switchValue([{ key: "other", value: "true" }])).toBe(false);
    expect(t.switchValue(null)).toBe(false);
  });
  it("verdictOf: ok / no_frozen pass through, anything else is 'unknown'", () => {
    const t = helpers();
    expect(t.verdictOf({ frozen_store_status: "ok" })).toBe("ok");
    expect(t.verdictOf({ frozen_store_status: "no_frozen" })).toBe("no_frozen");
    for (const v of [{ frozen_store_status: "open" }, { frozen_store_status: "full" }, { frozen_store_status: "unknown" }, {}, null, undefined, "no_frozen"]) expect(t.verdictOf(v)).toBe("unknown");
  });
  it("slowAnswer (1): no reply, a throw/cap, or a transient answer pauses; a real answer (ok / no_frozen / NO2 / close / bounce) never does", () => {
    const t = helpers();
    expect(t.slowAnswer(null, false)).toBe(true);
    expect(t.slowAnswer(undefined, false)).toBe(true);
    expect(t.slowAnswer({ frozen_store_status: "ok" }, true)).toBe(true);
    expect(t.slowAnswer({ frozen_store_status: "unknown", transient: true }, false)).toBe(true);
    for (const r of [{ frozen_store_status: "ok", transient: false }, { frozen_store_status: "no_frozen" }, { frozen_store_status: "unknown", frozen_reason: "store not found (NO2)", transient: false }]) expect(t.slowAnswer(r, false)).toBe(false);
  });
  it("pickRows: one per store, the floor, bad rows skipped, ≤ limit", () => {
    const t = helpers();
    const at = new Map([["151003", T0 - 2 * MIN]]);
    const rows = [...FROZEN_ROWS, { id: "x", store_id: "" }, null, { id: "fz-9", store_id: "999999" }];
    expect(t.pickRows(rows, at, T0, 3)).toEqual([{ id: "fz-1", store_id: "968551" }, { id: "fz-9", store_id: "999999" }]);
    expect(t.pickRows(rows, new Map(), T0, 1)).toEqual([{ id: "fz-1", store_id: "968551" }]);
    expect(t.pickRows("nope", new Map(), T0, 3)).toEqual([]);
  });
});
