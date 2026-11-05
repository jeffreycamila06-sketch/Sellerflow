// 1.17.0 — the FROZEN (冷凍) store-check lane (chrome-extension/frozen-check.js) under the real
// worker (background.js + importScripts) in the vm harness. Jeff's hard rules, each pinned:
//   • ADD ONLY — background.js differs from main by exactly two ADDED lines (the import + the kick);
//     no other extension file changed.
//   • switch OFF = byte-for-byte today's requests / DB writes / tab messages, compared against
//     MAIN's background.js run under the same harness. The ONE allowed difference: a read-only
//     GET of the switch row (≤ 1 per minute). Nothing else.
//   • dry parcels are never read here (the DB picks 冷凍 rows); the normal lane's calls are
//     identical with the frozen lane on.
//   • error isolation: a throwing / hanging / silent emap script, a failing pending or verdict
//     RPC — only THAT parcel gets 'unknown', the normal lane is untouched, the pass never waits.
//   • budget: one row per store per pass, a 10-min per-store floor, the 01:00–05:00 window,
//     leader-only, nothing without the E-Map tab.
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000, MIN = 60 * S;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei, outside the maintenance window — in the PAST so the harness's fake JWT (exp = real now + 1 h) is valid on this clock
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
// Always the leader (a fresh lease answer every call).
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "test", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const FROZEN_ROWS = [
  { id: "fz-1", store_id: "968551", created_at: new Date(T0 - 60 * S).toISOString(), queue_depth: 3 },
  { id: "fz-2", store_id: "968551", created_at: new Date(T0 - 50 * S).toISOString(), queue_depth: 3 }, // same store → not this pass
  { id: "fz-3", store_id: "151003", created_at: new Date(T0 - 40 * S).toISOString(), queue_depth: 3 },
];
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
type Calls = ReturnType<typeof bootWorker>["calls"];
type W = ReturnType<typeof bootWorker>;
// The only thing that legitimately differs between two boots is the random worker id (lease
// body + the Admin-card blob) — normalised so the traces compare byte-for-byte.
const wid = (w: W): string => String((w.storage.pc_worker as { id?: string } | undefined)?.id ?? "");
const norm = (w: W, s: string): string => (wid(w) ? s.split(wid(w)).join("WID") : s);
const trace = (w: W) => ({
  fetch: w.calls.fetch.map((u, i) => [u, norm(w, w.calls.fetchBodies[i])]),
  msgs: w.calls.sendMessage.map((m) => `${m.type}:${m.tabId}:${m.rowId ?? ""}`),
});
const SWITCH_GET = /rest\/v1\/app_settings\?select=key,value&key=eq\.frozen_store_check_enabled$/;
const frozenFetches = (c: Calls) => c.fetch.filter((u) => /admin_parcel_frozen_/.test(u));
const frozenMsgs = (c: Calls) => c.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK");
const verdictBodies = (c: Calls) => c.fetch.map((u, i) => [u, c.fetchBodies[i]] as const).filter(([u]) => /admin_parcel_frozen_verdict/.test(u)).map(([, b]) => JSON.parse(b) as { p_id: string; p_expected_store: string; p_status: string });
const normalLane = (w: W) => ({
  fetch: w.calls.fetch.map((u, i) => [u, norm(w, w.calls.fetchBodies[i])]).filter(([u]) => !SWITCH_GET.test(u) && !/admin_parcel_frozen_/.test(u)),
  msgs: w.calls.sendMessage.filter((m) => m.type !== "PC_FROZEN_CHECK" && m.type !== "PC_FROZEN_PING").map((m) => `${m.type}:${m.tabId}:${m.rowId ?? ""}`),
});

// MAIN's background.js, for the byte-for-byte comparison (fetched shallowly when the ref is missing, e.g. CI).
let mainDir = "";
beforeAll(() => {
  mainDir = join(tmpdir(), `sfl-main-ext-${process.pid}`);
  mkdirSync(mainDir, { recursive: true });
  let ref = "origin/main";
  try { execSync("git rev-parse --verify --quiet origin/main", { stdio: "pipe" }); } catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); ref = "FETCH_HEAD"; }
  writeFileSync(join(mainDir, "background.js"), execSync(`git show ${ref}:chrome-extension/background.js`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
});

async function run(opts: Opts, ticks = 3) {
  const clock = { t: T0 };
  const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, ...opts });
  await w.booted;
  for (let i = 0; i < ticks; i++) { await w.sb.pcRunOnce(); await flush(); clock.t += 5 * S; }
  return { w, clock };
}

describe("ADD ONLY — the diff against main", () => {
  it("background.js: exactly two ADDED lines (the import and the kick), zero removed or changed; every other existing extension file is byte-identical to main", () => {
    const ref = (() => { try { execSync("git rev-parse --verify --quiet origin/main", { stdio: "pipe" }); return "origin/main"; } catch { return "FETCH_HEAD"; } })();
    const diff = execSync(`git diff ${ref} -- chrome-extension/background.js`, { encoding: "utf8" });
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removed).toEqual([]);
    expect(added.map((l) => l.slice(1).trim())).toEqual([
      "try { importScripts(\"frozen-check.js\"); } catch (e) { console.log(`[PC-FROZEN] module not loaded: ${e && e.message}`); } // 1.17.0 ADD-ONLY: the FROZEN (冷凍) store check lives in its own module (kicked by one line in pcRunOnce); a missing/broken module never stops the worker",
      "try { if (typeof pcFrozenKick === \"function\") pcFrozenKick(pass); } catch (e) { console.log(`[PC-FROZEN] skipped: ${e && e.message ? e.message : e}`); } // 1.17.0 ADD-ONLY: never awaited — the frozen check runs on its own promise; absent module = no-op",
    ]);
    for (const f of ["emap-711.js", "emap-guid-main.js", "myship-711.js", "myship-order-711.js", "myship-export-711.js", "myship-export-hook.js", "popup.js", "popup.html", "sellerflow-bridge.js", "sellerflow-refresh-main.js"]) {
      expect(execSync(`git diff ${ref} -- chrome-extension/${f}`, { encoding: "utf8" }), f).toBe("");
    }
    const manifest = execSync(`git diff ${ref} -- chrome-extension/manifest.json`, { encoding: "utf8" }).split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(manifest.map((l) => l.trim())).toEqual(['-  "version": "1.15.2",']); // only the version line changed; the new content-script entry is pure insertion
  });
  it("the kick is the only call into the module from existing code, and the module never calls into the normal lane's row flow", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    expect(bg.split("pcFrozen").length - 1).toBe(2); // the kick line only (typeof guard + the call), nothing else
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(mod).not.toMatch(/pcPollMulti|pcPoll\(|pcEmapKeepalive\(|pcRefreshTabStatus|pcBackoff|pcEv\.emap\.(lastVerdictAt|misses|lastMissAt)|PC_CHECK_STORE|admin_parcel_check_verdict|admin_parcel_checks_pending/);
  });
  it("1. a MISSING frozen-check.js, or one that throws at load, never stops the worker: it boots and the normal lane writes its verdict", async () => {
    for (const src of [null, 'throw new Error("boom at top level");'] as const) {
      const clock = { t: T0 };
      const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenModuleSrc: src });
      await w.booted;
      for (let i = 0; i < 3; i++) { await w.sb.pcRunOnce(); await flush(); clock.t += 5 * S; }
      expect(w.calls.logs.some((l) => /\[PC-FROZEN\] module not loaded: /.test(l)), String(src)).toBe(true);
      expect(w.calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u)), `${src}: normal verdict`).toBe(true);
      expect(frozenMsgs(w.calls), String(src)).toEqual([]);
      expect(w.calls.logs.filter((l) => /\[PC-FROZEN\] skipped/.test(l)), String(src)).toEqual([]); // the kick line is a no-op, not an error
    }
  });
});

describe("timeouts, per-row gates, no-overlap, self-heal", () => {
  const timersOf = (w: ReturnType<typeof bootWorker>, ms: number) => w.calls.timers.filter((t) => t.ms === ms);
  it("2. a hung frozen check (never answers) → the 15 s timeout writes 'unknown' and the lane is not left busy (the next kick runs)", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS.slice(0, 1), frozenVerdict: () => "hang" }, 1);
    expect(frozenMsgs(w.calls)).toHaveLength(1);
    expect(verdictBodies(w.calls)).toEqual([]);
    clock.t += 20 * S;
    await w.sb.pcRunOnce(); await flush();                       // still busy → no second frozen message
    expect(frozenMsgs(w.calls)).toHaveLength(1);
    const pending = timersOf(w, 15 * S);
    expect(pending.length).toBeGreaterThan(0);
    pending[pending.length - 1].fn(); await flush();             // the frozen-check timeout fires
    expect(verdictBodies(w.calls).map((v) => `${v.p_id}:${v.p_status}`)).toEqual(["fz-1:unknown"]);
    expect(w.calls.logs.some((l) => /frozen check timeout \(15s\)/.test(l))).toBe(true);
    clock.t += 11 * MIN;                                         // past the store floor
    await w.sb.pcRunOnce(); await flush();
    expect(frozenMsgs(w.calls)).toHaveLength(2);                 // the lane is free again
  });
  it("2b. every frozen fetch / RPC / message is bounded: the switch read, the pending read, the verdict write", () => {
    const mod = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(mod.match(/pcFrozenWithTimeout\(/g)?.length).toBe(6); // definition + switch + pending + ping (inside ensureScript) + check + verdict
    expect(mod).toContain('"switch read")'); expect(mod).toContain('"pending read")'); expect(mod).toContain('"frozen check")'); expect(mod).toContain('"verdict write")'); expect(mod).toContain('"frozen ping")');
  });
  it("3. the leader and the maintenance window are re-checked before EACH row", async () => {
    const clock = { t: T0 };
    // the first frozen row's answer loses the lease (another machine took over) → the second row is not sent
    const w = bootWorker({ now: () => clock.t, rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: () => { w.evalIn('pcLease.role = "standby";'); return "ok"; } });
    await w.booted;
    for (let i = 0; i < 4; i++) { await w.sb.pcRunOnce(); await flush(); clock.t += 5 * S; } // past the keepalive guard (empty queue → 3 rows per pass)
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    expect(w.calls.logs).toContain("[PC-FROZEN] lease lost mid-pass — stopping");
    // maintenance: the clock enters the window after the first row
    const clock2 = { t: Date.UTC(2026, 0, 15, 16, 59, 40) }; // 00:59:40 Taipei — the keepalive guard ends at :55, the window starts at 01:00
    const w2 = bootWorker({ now: () => clock2.t, rows: [], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: () => { clock2.t += 5 * S; return "ok"; } });
    await w2.booted;
    for (let i = 0; i < 5; i++) { if (frozenMsgs(w2.calls).length) break; await w2.sb.pcRunOnce(); await flush(); clock2.t += 5 * S; } // the first row goes at :55; its answer moves the clock into the window
    expect(frozenMsgs(w2.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    expect(w2.calls.logs).toContain("[PC-FROZEN] maintenance window started — stopping");
  });
  it("4. never overlaps the normal lane: 100 dry rows + 3 frozen → all 3 answered within 3 minutes and no frozen request while a normal one is open", async () => {
    const dry = Array.from({ length: 100 }, (_, i) => ({ ...PENDING_ROW, id: `dry-${i + 1}`, store_id: String(100000 + i), queue_depth: 100 }));
    const threeStores = [FROZEN_ROWS[0], { ...FROZEN_ROWS[1], store_id: "133712" }, FROZEN_ROWS[2]]; // three different stores (one per store per pass)
    const clock = { t: T0 };
    const w = bootWorker({ now: () => clock.t, rows: dry, lease: LEADER, slowChecks: true, frozenSwitch: "true", frozenPending: threeStores, frozenVerdict: () => "ok" });
    await w.booted;
    for (let i = 0; i < 36; i++) { await w.sb.pcRunOnce(); await flush(60); clock.t += 5 * S; } // 3 minutes of passes
    expect(verdictBodies(w.calls).map((v) => v.p_id).sort()).toEqual(["fz-1", "fz-2", "fz-3"]);
    expect(w.calls.frozenOverlap).toBe(0);
    expect(w.calls.fetch.filter((u) => /admin_parcel_check_verdict/.test(u)).length).toBeGreaterThan(50); // the dry queue kept moving
    expect(w.calls.logs.filter((l) => /\[PC-FROZEN\] row=/.test(l)).length).toBe(3);
  });
  it("4b. with a dry queue waiting, ONE frozen row per pass (fairness both ways); with an empty queue up to 3 — and never while the keepalive is due / just sent", async () => {
    const dry = Array.from({ length: 10 }, (_, i) => ({ ...PENDING_ROW, id: `dry-${i + 1}`, queue_depth: 10 }));
    const four = [...FROZEN_ROWS, { id: "fz-4", store_id: "222222" }];
    const busy = await run({ rows: dry, frozenSwitch: "true", frozenPending: four }, 1);
    expect(frozenMsgs(busy.w.calls).map((m) => m.rowId)).toEqual(["fz-1"]);
    const idle = await run({ rows: [], frozenSwitch: "true", frozenPending: four }, 1);
    expect(frozenMsgs(idle.w.calls)).toHaveLength(0);                   // pass 1: the E-Map keepalive is due → wait (it fires in this pass)
    expect(idle.w.calls.logs).toContain("[PC-FROZEN] normal lane busy — retry next pass");
    for (let i = 0; i < 3; i++) { idle.clock.t += 5 * S; await idle.w.sb.pcRunOnce(); await flush(); }
    expect(frozenMsgs(idle.w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3", "fz-4"]); // 15 s after the keepalive: three stores in one pass
  });
  it("5. self-heal: no answer from the frozen content script → it is injected into the E-Map tab and the check proceeds", async () => {
    const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS.slice(0, 1), frozenScript: false }, 1);
    expect(a.w.calls.injected).toEqual(["emap-frozen-711.js"]);
    expect(a.w.calls.logs.some((l) => /emap-frozen-711\.js not answering on tab 3 → injected/.test(l))).toBe(true);
    expect(frozenMsgs(a.w.calls)).toHaveLength(1);
    expect(verdictBodies(a.w.calls).map((v) => v.p_status)).toEqual(["ok"]);
    // the normal lane's own heal/injection is untouched: the existing executeScript path is never called for emap-711.js here
    expect(a.w.calls.injected.filter((f) => f === "emap-711.js")).toEqual([]);
  });
});

describe("switch OFF = today's worker (compared to main)", () => {
  for (const frozenSwitch of ["missing", "false", "error"] as const) {
    it(`switch ${frozenSwitch}: every request, DB write and tab message equals main's, except one read-only GET of the switch row per minute`, async () => {
      const a = await run({ frozenSwitch, frozenPending: FROZEN_ROWS }, 4);
      const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 4);
      const ours = trace(a.w), theirs = trace(m.w);
      const extra = ours.fetch.filter(([u]) => SWITCH_GET.test(u));
      expect(extra.length, "the switch GET: at most once a minute (4 ticks × 5 s = 1)").toBe(1);
      expect(ours.fetch.filter(([u]) => !SWITCH_GET.test(u))).toEqual(theirs.fetch);
      expect(ours.msgs).toEqual(theirs.msgs);
      expect(frozenFetches(a.w.calls)).toEqual([]);
      expect(frozenMsgs(a.w.calls)).toEqual([]);
      expect(a.w.calls.logs.filter((l) => /\[PC-FROZEN\]/.test(l))).toEqual(["[PC-FROZEN] switch off"]);
    });
  }
  it("'TRUE' / 'yes' / 1 are not the exact string 'true' → off", () => {
    const src = readFileSync("chrome-extension/frozen-check.js", "utf8");
    expect(src).toContain('r.value === "true"');
  });
  it("the status/popup state the normal lane writes is identical with the module loaded (switch off)", async () => {
    const a = await run({ frozenSwitch: "false" }, 2);
    const m = await run({ extDir: mainDir }, 2);
    const scrub = (w: W) => JSON.parse(norm(w, JSON.stringify(w.status()))) as unknown;
    expect(scrub(a.w)).toEqual(scrub(m.w));
  });
});

describe("switch ON — the frozen lane", () => {
  it("checks one row per store per pass with cate=27 through its own message, writes its own verdict RPC, and the NORMAL lane's calls are identical to main's", async () => {
    const verdicts: Record<string, string> = { "968551": "no_frozen", "151003": "ok" };
    const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => verdicts[row?.store_id ?? ""] ?? "unknown" }, 2);
    expect(frozenMsgs(a.w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3"]); // one per pass while a dry row is queued; fz-2 = same store as fz-1, waits
    expect(verdictBodies(a.w.calls)).toEqual([
      { p_id: "fz-1", p_expected_store: "968551", p_status: "no_frozen" },
      { p_id: "fz-3", p_expected_store: "151003", p_status: "ok" },
    ]);
    expect(a.w.calls.fetchBodies[a.w.calls.fetch.findIndex((u) => /admin_parcel_frozen_pending/.test(u))]).toBe('{"p_limit":3}');
    expect(frozenMsgs(a.w.calls).every((m) => m.tabId === 3)).toBe(true); // the E-Map tab the normal lane picked
    const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 2);
    expect(normalLane(a.w)).toEqual(trace(m.w));
    expect(a.w.calls.logs.filter((l) => /\[PC-FROZEN\] row=/.test(l))).toEqual(["[PC-FROZEN] row=fz-1 store=968551 → no_frozen", "[PC-FROZEN] row=fz-3 store=151003 → ok"]);
  });
  it("10-min floor per store: the same store is not asked again within 10 min, even if the RPC keeps returning it; after 10 min it is", async () => {
    const { w, clock } = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS }, 4); // 4 passes in 20 s: fz-1, fz-3, then nothing (both stores under the floor)
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3"]);
    clock.t += 10 * MIN;
    await w.sb.pcRunOnce(); await flush(); clock.t += 5 * S; await w.sb.pcRunOnce(); await flush();
    expect(frozenMsgs(w.calls).map((m) => m.rowId)).toEqual(["fz-1", "fz-3", "fz-1", "fz-3"]);
  });
  it("the emap script THROWS / never answers / returns garbage / answers null → that parcel is written 'unknown', the others still get their verdict, the normal lane is untouched, and the pass never waits", async () => {
    for (const bad of ["throw", "hang", "garbage", null] as const) {
      const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdict: (row) => (row?.store_id === "968551" ? bad : "ok") }, 2);
      const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 2);
      expect(normalLane(a.w), String(bad)).toEqual(trace(m.w));
      if (bad === "hang") {
        // the kick returned, pcRunOnce finished, the normal lane completed — the hung check only holds the frozen lane
        expect(verdictBodies(a.w.calls), "hang").toEqual([]);
        expect(a.w.calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u)), "hang: normal verdict written").toBe(true);
        continue;
      }
      expect(verdictBodies(a.w.calls).map((v) => `${v.p_id}:${v.p_status}`), String(bad)).toEqual(["fz-1:unknown", "fz-3:ok"]);
      expect(a.w.calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u)), String(bad)).toBe(true);
    }
  });
  it("a failing pending RPC (500) or verdict RPC (500) only logs; nothing else changes for the normal lane", async () => {
    const p = await run({ frozenSwitch: "true", frozenPending: "error" }, 2);
    expect(frozenMsgs(p.w.calls)).toEqual([]);
    expect(p.w.calls.logs).toContain("[PC-FROZEN] pending rpc_500");
    const v = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, frozenVerdictHttp: 500 }, 2);
    expect(v.w.calls.logs.filter((l) => /verdict rpc_500/.test(l))).toHaveLength(2);
    const m = await run({ extDir: mainDir, frozenPending: FROZEN_ROWS }, 2);
    expect(normalLane(p.w)).toEqual(trace(m.w));
    expect(normalLane(v.w)).toEqual(trace(m.w));
  });
  it("maintenance window (01:00–05:00 Taipei): no frozen request; the switch read still happens", async () => {
    const clock = { t: Date.UTC(2026, 0, 15, 18, 30, 0) }; // 02:30 Taipei (Jan 16)
    const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: LEADER, maintenance: true, frozenSwitch: "true", frozenPending: FROZEN_ROWS });
    await w.booted; await w.sb.pcRunOnce(); await flush();
    expect(frozenMsgs(w.calls)).toEqual([]);
    expect(w.calls.fetch.some((u) => /admin_parcel_frozen_pending/.test(u))).toBe(false);
    expect(w.calls.fetch.filter((u) => SWITCH_GET.test(u))).toHaveLength(1);
  });
  it("standby (not the leader) → nothing frozen, not even the switch read", async () => {
    const standby: Opts["lease"] = () => ({ json: { leader: false, reason: "leader_alive", leader_id: "other", leader_label: "Mac", leader_age_s: 1, standby_ready: true, standby_age_s: 1, ttl_s: 120 } });
    const clock = { t: T0 };
    const w = bootWorker({ now: () => clock.t, rows: [PENDING_ROW], lease: standby, frozenSwitch: "true", frozenPending: FROZEN_ROWS });
    await w.booted; await w.sb.pcRunOnce(); await flush();
    expect(w.calls.fetch.filter((u) => SWITCH_GET.test(u) || /admin_parcel_frozen_/.test(u))).toEqual([]);
    expect(frozenMsgs(w.calls)).toEqual([]);
  });
  it("no E-Map tab → the frozen rows stay queued (no request, no 'unknown' stamped for our own missing tab)", async () => {
    const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, emapTab: false }, 1);
    expect(frozenMsgs(a.w.calls)).toEqual([]);
    expect(verdictBodies(a.w.calls)).toEqual([]);
    expect(a.w.calls.fetch.some((u) => /admin_parcel_frozen_pending/.test(u))).toBe(false);
  });
  it("paused / multi-seller off → nothing frozen", async () => {
    const a = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, config: { paused: true } }, 1);
    expect(a.w.calls.fetch.filter((u) => SWITCH_GET.test(u) || /admin_parcel_frozen_/.test(u))).toEqual([]);
    const b = await run({ frozenSwitch: "true", frozenPending: FROZEN_ROWS, multiSeller: false }, 1);
    expect(b.w.calls.fetch.filter((u) => SWITCH_GET.test(u) || /admin_parcel_frozen_/.test(u))).toEqual([]);
  });
});

describe("pure helpers", () => {
  const w = bootWorker({ lease: LEADER });
  const sb = w.sb as unknown as Record<string, (...a: unknown[]) => unknown>;
  it("pcFrozenSwitchValue: only the exact key + 'true'", () => {
    expect(sb.pcFrozenSwitchValue([{ key: "frozen_store_check_enabled", value: "true" }])).toBe(true);
    for (const v of ["TRUE", "yes", "1", " true", ""]) expect(sb.pcFrozenSwitchValue([{ key: "frozen_store_check_enabled", value: v }]), v).toBe(false);
    expect(sb.pcFrozenSwitchValue([{ key: "other", value: "true" }])).toBe(false);
    expect(sb.pcFrozenSwitchValue(null)).toBe(false);
  });
  it("pcFrozenVerdictOf: ok / no_frozen pass through, anything else is 'unknown'", () => {
    expect(sb.pcFrozenVerdictOf({ frozen_store_status: "ok" })).toBe("ok");
    expect(sb.pcFrozenVerdictOf({ frozen_store_status: "no_frozen" })).toBe("no_frozen");
    for (const v of [{ frozen_store_status: "open" }, { frozen_store_status: "full" }, { frozen_store_status: "unknown" }, {}, null, undefined, "no_frozen"]) expect(sb.pcFrozenVerdictOf(v)).toBe("unknown");
  });
  it("pcFrozenPickRows: one per store, the floor, bad rows skipped, ≤ limit", () => {
    const at = new Map([["151003", T0 - 2 * MIN]]);
    const rows = [...FROZEN_ROWS, { id: "x", store_id: "" }, null, { id: "fz-9", store_id: "999999" }];
    expect(sb.pcFrozenPickRows(rows, at, T0, 3)).toEqual([{ id: "fz-1", store_id: "968551" }, { id: "fz-9", store_id: "999999" }]);
    expect(sb.pcFrozenPickRows(rows, new Map(), T0, 1)).toEqual([{ id: "fz-1", store_id: "968551" }]);
    expect(sb.pcFrozenPickRows("nope", new Map(), T0, 3)).toEqual([]);
  });
});
