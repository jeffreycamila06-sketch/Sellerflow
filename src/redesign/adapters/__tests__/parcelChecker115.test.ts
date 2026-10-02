// 1.15.0 — TWO-MACHINE FAILOVER. Real background.js workers (shared vm harness) against ONE
// fake lease that mirrors sql/71 v2: calling it IS the renewal; leader silent > 120 s →
// takeover; a fresh wid-less (pre-1.15) heartbeat makes EVERYONE stand down; a DEGRADED
// leader yields to a READY standby seen ≤ 30 s ago, then sits out a 90 s cooldown; no
// preferred machine. Only the leader may make the duty calls; the standby keeps its tabs
// ready (pick + keepalive + status) and may still sync its own Pickup Status.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker, fakeJwt, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000, MIN = 60 * S;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei — outside the maintenance window

type Body = { p_worker_id: string; p_label: string; p_state: Record<string, unknown> };
// sql/71 v2 on a shared test clock.
function leaseServer(clock: { t: number }) {
  const st = {
    leaderId: null as string | null, leaderLabel: null as string | null, leaderAt: 0,
    standbyId: null as string | null, standbyAt: 0, standbyState: null as Record<string, unknown> | null,
    yieldBlockId: null as string | null, yieldBlockUntil: 0, takeovers: 0, yields: 0, down: false, legacyAt: 0,
  };
  const handler = (b: Body) => {
    if (st.down) return "throw" as const;
    const now = clock.t;
    const fresh = st.leaderId !== null && now - st.leaderAt < 120 * S;
    const legacy = st.legacyAt > 0 && now - st.legacyAt < 150 * S;            // ALWAYS evaluated (M3)
    const sb = st.standbyState;
    const sbReady = !!st.standbyId && st.standbyId !== b.p_worker_id && now - st.standbyAt < 30 * S && !!sb
      && sb.sfl === "connected" && sb.emap === "ok" && (sb.myship === "ok" || sb.myship === "stale") && sb.multi === true && sb.degraded !== true;
    let leader = false, reason: string, asStandby = false;
    if (legacy) { asStandby = true; reason = "legacy_worker_active"; }
    else if (fresh && st.leaderId !== b.p_worker_id) { asStandby = true; reason = "leader_alive"; }
    else if (fresh && st.leaderId === b.p_worker_id && b.p_state?.degraded === true && sbReady) {
      st.leaderId = null; st.leaderAt = 0; st.yieldBlockId = b.p_worker_id; st.yieldBlockUntil = now + 90 * S; st.yields += 1;
      reason = "yielded";
    } else if (!fresh && st.yieldBlockId === b.p_worker_id && st.yieldBlockUntil > now) { asStandby = true; reason = "yield_cooldown"; }
    else {
      if (st.leaderId !== b.p_worker_id) { st.takeovers += 1; if (st.yieldBlockId !== b.p_worker_id) { st.yieldBlockId = null; st.yieldBlockUntil = 0; } }
      st.leaderId = b.p_worker_id; st.leaderLabel = b.p_label; st.leaderAt = now;
      if (st.standbyId === b.p_worker_id) { st.standbyId = null; st.standbyState = null; }
      leader = true; reason = "leader";
    }
    if (asStandby) { st.standbyId = b.p_worker_id; st.standbyAt = now; st.standbyState = b.p_state; }
    return { json: { leader, reason, leader_id: legacy ? null : st.leaderId, leader_label: legacy ? "pre-1.15 worker" : st.leaderLabel,
      leader_age_s: st.leaderAt ? Math.round((now - st.leaderAt) / S) : null, standby_ready: sbReady, ttl_s: 120 } };
  };
  return { st, handler };
}

type Calls = ReturnType<typeof bootWorker>["calls"];
// Every network / DB side effect of DUTY work the STANDBY must never make. (The
// parcel_tracking upserts are NOT duty work — they follow Jeff's own open 賣貨便 pages,
// on whichever machine — so a standby still makes them; see the test below.)
const FORBIDDEN = [/admin_parcel_checks_pending/, /admin_parcel_check_config/, /admin_set_parcel_sender_health/, /admin_parcel_check_verdict/,
  /admin_parcel_check_requeue/, /admin_set_parcel_worker_state/, /rest\/v1\/parcel_scans/];
const forbiddenFetches = (c: Calls) => c.fetch.filter((u) => FORBIDDEN.some((re) => re.test(u)));
const rowChecks = (c: Calls) => c.sendMessage.filter((m) => (m.type === "PC_CHECK_PHONE") || (m.type === "PC_CHECK_STORE" && m.rowId));
const count = (c: Calls, re: RegExp) => c.fetch.filter((u) => re.test(u)).length;
const pendingReads = (c: Calls) => count(c, /admin_parcel_checks_pending/);
const verdicts = (c: Calls) => count(c, /admin_parcel_check_verdict/);
const leaseLogs = (c: Calls) => c.logs.filter((l) => /\[PC-LEASE\]/.test(l));
const leaseBodies = (c: Calls) => c.fetch.map((u, i) => [u, c.fetchBodies[i]] as const).filter(([u]) => /admin_parcel_worker_lease/.test(u)).map(([, b]) => JSON.parse(b) as Body);
const clicks = (c: Calls) => c.sendMessage.filter((m) => m.type === "PC_CLICK_PICK_STORE").length;

type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
async function twoWorkers(rows: unknown[] = [PENDING_ROW], extraA: Opts = {}, extraB: Opts = {}) {
  const clock = { t: T0 };
  const lease = leaseServer(clock);
  const a = bootWorker({ now: () => clock.t, rows, lease: lease.handler, ...extraA, config: { deviceName: "Windows laptop" } });
  const b = bootWorker({ now: () => clock.t, rows, lease: lease.handler, ...extraB, config: { deviceName: "Mac" } });
  await a.booted; await b.booted;
  return { clock, lease, a, b };
}
// Another machine grabs the lease right now (fresh leader "other").
const steal = (lease: ReturnType<typeof leaseServer>, clock: { t: number }) => { lease.st.leaderId = "other"; lease.st.leaderLabel = "Mac"; lease.st.leaderAt = clock.t; };

describe("two workers, one lease (sql/71 v2)", () => {
  it("only the leader reads pending / checks / writes; the standby makes NONE of the duty calls", async () => {
    const { clock, a, b, lease } = await twoWorkers();
    for (let i = 0; i < 6; i++) { await a.sb.pcTick(); await b.sb.pcTick(); clock.t += 5 * S; }
    expect(a.status().leaseRole).toBe("leader");
    expect(b.status().leaseRole).toBe("standby");
    expect(pendingReads(a.calls)).toBeGreaterThan(0);
    expect(verdicts(a.calls)).toBeGreaterThan(0);
    expect(rowChecks(a.calls).length).toBeGreaterThan(0);
    expect(forbiddenFetches(b.calls)).toEqual([]);
    expect(rowChecks(b.calls)).toEqual([]);
    // the standby still keeps itself ready: it called the lease every pass and reported its state
    expect(count(b.calls, /admin_parcel_worker_lease/)).toBe(6);
    expect(lease.st.standbyState).toMatchObject({ v: "test", sfl: "connected", multi: true, degraded: false, leaseFailing: false });
    expect(b.status().leaseLeaderLabel).toBe("Windows laptop");
  });

  it("the standby keeps the E-Map session alive (keepalive is a both-roles job)", async () => {
    const { clock, a, b } = await twoWorkers([]);
    await a.sb.pcTick(); await b.sb.pcTick();
    clock.t += 5 * MIN + S;
    await a.sb.pcTick(); await b.sb.pcTick();
    expect(b.calls.logs.some((l) => /\[PC-KEEPALIVE\]/.test(l))).toBe(true);
    expect(b.calls.sendMessage.some((m) => m.type === "PC_CHECK_STORE" && !m.rowId)).toBe(true);
  });

  it("takeover: the leader goes silent past the 120 s TTL → the standby takes over and starts checking", async () => {
    const { clock, a, b, lease } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    expect(b.status().leaseRole).toBe("standby");
    clock.t += 121 * S; // A says nothing (machine off)
    const before = pendingReads(b.calls);
    await b.sb.pcTick();
    expect(b.status().leaseRole).toBe("leader");
    expect(pendingReads(b.calls)).toBeGreaterThan(before);
    expect(lease.st.takeovers).toBe(2);
    expect(leaseLogs(b.calls).some((l) => /STANDBY → LEADER/.test(l))).toBe(true);
  });

  it("no flapping: a returning worker stays standby while the other one is alive", async () => {
    const { clock, a, b } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    clock.t += 121 * S;
    await b.sb.pcTick();                              // B took over
    const aForbiddenBefore = forbiddenFetches(a.calls).length;
    for (let i = 0; i < 4; i++) { clock.t += 5 * S; await a.sb.pcTick(); await b.sb.pcTick(); }
    expect(a.status().leaseRole).toBe("standby");
    expect(b.status().leaseRole).toBe("leader");
    expect(forbiddenFetches(a.calls).length).toBe(aForbiddenBefore); // nothing new since it came back
    expect(leaseLogs(a.calls).some((l) => /LEADER → STANDBY/.test(l))).toBe(true);
  });

  it("v2 legacy guard: a fresh pre-1.15 heartbeat makes even the 1.15 LEADER stand down (no double work after a rollback)", async () => {
    const { clock, a, b, lease } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    lease.st.legacyAt = clock.t;                     // 1.14.9 running on another machine
    clock.t += 5 * S;
    const aBefore = forbiddenFetches(a.calls).length, bBefore = forbiddenFetches(b.calls).length;
    await a.sb.pcTick(); await b.sb.pcTick();
    expect(a.status().leaseRole).toBe("standby");
    expect(a.status().leaseReason).toBe("legacy_worker_active");
    expect(forbiddenFetches(a.calls).length).toBe(aBefore);
    expect(forbiddenFetches(b.calls).length).toBe(bBefore);
  });
});

describe("H1 — degraded + yield", () => {
  it("degraded = duty tabs dead for 10 continuous minutes (emap no_tab), reported in p_state", async () => {
    const clock = { t: T0 };
    const lease = leaseServer(clock);
    const w = bootWorker({ now: () => clock.t, rows: [], lease: lease.handler, emapTab: false, cartDetailTab: false });
    await w.booted;
    for (let i = 0; i < 20; i++) { await w.sb.pcTick(); clock.t += 30 * S; }   // 9.5 min of dead tabs counted
    expect(leaseBodies(w.calls).pop()!.p_state.degraded).toBe(false);
    expect(w.status().degraded).toBe(false);
    await w.sb.pcTick(); clock.t += 30 * S;                                       // 10 min → degraded
    expect(w.status().degraded).toBe(true);
    await w.sb.pcTick();                                                          // the next lease call carries it
    expect(leaseBodies(w.calls).pop()!.p_state.degraded).toBe(true);
    expect(w.calls.logs.filter((l) => /DEGRADED — duty tabs dead 10\+ min/.test(l)).length).toBe(1);
  });

  it("time inside 01:00–05:00 does not count (frozen, not reset); recovering resets; a sleep counts ≤ 60 s", async () => {
    const T_0055 = Date.UTC(2026, 0, 14, 16, 55, 0);  // 00:55 Taipei
    const clock = { t: T_0055 };
    const lease = leaseServer(clock);
    const w = bootWorker({ now: () => clock.t, rows: [], lease: lease.handler, emapTab: false, cartDetailTab: false, maintenance: true });
    await w.booted;
    for (let i = 0; i < 10; i++) { await w.sb.pcTick(); clock.t += 30 * S; }                       // 00:55 → 01:00: 4.5 min counted
    while (clock.t < Date.UTC(2026, 0, 14, 21, 0, 0)) { await w.sb.pcTick(); clock.t += 30 * MIN; } // the window: frozen
    expect(w.status().degraded).toBe(false);
    clock.t = Date.UTC(2026, 0, 14, 21, 0, 10);                                                    // 05:00:10
    for (let i = 0; i < 9; i++) { await w.sb.pcTick(); clock.t += 30 * S; }                        // +5 min → 9.5 min
    expect(w.status().degraded).toBe(false);
    await w.sb.pcTick();                                                                           // 10 min outside the window
    expect(w.status().degraded).toBe(true);
    const step = w.sb.pcDegradedStep as unknown as (d: unknown, n: number, dead: boolean, m: boolean) => { ms: number; on: boolean };
    expect(step({ ms: 9 * MIN, lastAt: 1000, on: false }, 1000 + 30 * S, true, true).ms).toBe(9 * MIN);   // frozen in the window
    expect(step({ ms: 9 * MIN, lastAt: 1000, on: false }, 1000 + 30 * S, false, true).ms).toBe(0);        // recovered → reset
    expect(step({ ms: 0, lastAt: 1000, on: false }, 1000 + 10 * MIN, true, false).ms).toBe(60 * S);       // a sleep counts ≤ 60 s
    expect(step({ ms: 0, lastAt: 0, on: false }, 1000, true, false).ms).toBe(0);                          // first evaluation counts nothing
    const dead = w.sb.pcDutyTabsDead as unknown as (e: string, m: string | null) => boolean;
    expect(["no_tab", "expired", "dead"].map((e) => dead(e, "ok"))).toEqual([true, true, true]);
    expect(["no_tab", "dead_script"].map((m) => dead("ok", m))).toEqual([true, true]);
    expect(["ok", "stale", "degraded", "recovering", "reminting", "guid_missing"].map((e) => dead(e, "ok"))).toEqual([false, false, false, false, false, false]);
    expect(dead("ok", "healing")).toBe(false);
  });

  it("a DEGRADED leader yields to a READY standby → 'yielded' (= standby), the standby takes over, the yielder stays standby", async () => {
    const { clock, a, b, lease } = await twoWorkers([], { emapTab: false, cartDetailTab: false });
    await a.sb.pcTick(); await b.sb.pcTick();                   // A leads (its tabs are dead), B waits
    expect(a.status().leaseRole).toBe("leader");
    for (let i = 0; i < 30 && lease.st.yields === 0; i++) { clock.t += 30 * S; await b.sb.pcTick(); await a.sb.pcTick(); }
    expect(lease.st.yields).toBe(1);
    expect(a.status().leaseRole).toBe("standby");
    expect(a.status().leaseReason).toBe("yielded");
    expect(leaseLogs(a.calls).some((l) => /LEADER → STANDBY \(reason=yielded/.test(l))).toBe(true);
    const aBefore = forbiddenFetches(a.calls).length;
    clock.t += 5 * S; await b.sb.pcTick();
    expect(b.status().leaseRole).toBe("leader");
    expect(pendingReads(b.calls)).toBeGreaterThan(0);
    clock.t += 5 * S; await a.sb.pcTick();
    expect(a.status().leaseRole).toBe("standby");
    expect(forbiddenFetches(a.calls).length).toBe(aBefore);    // a yielder does no duty work
  });

  it("'yield_cooldown' is plain standby: no duty calls", async () => {
    const clock = { t: T0 };
    const w = bootWorker({ now: () => clock.t, lease: () => ({ json: { leader: false, reason: "yield_cooldown", leader_id: null, leader_label: null, leader_age_s: null, standby_ready: false, ttl_s: 120 } }) });
    await w.booted; await w.sb.pcTick();
    expect(w.status().leaseRole).toBe("standby");
    expect(forbiddenFetches(w.calls)).toEqual([]);
    expect(rowChecks(w.calls)).toEqual([]);
  });
});

describe("long passes, lease failures, M1", () => {
  it("a leader that gets leader:false mid-pass stops before the next row", async () => {
    const clock = { t: T0 };
    const lease = leaseServer(clock);
    const rows = ["r1", "r2", "r3"].map((id) => ({ ...PENDING_ROW, id, need_store: false }));
    const w = bootWorker({ now: () => clock.t, rows, lease: lease.handler,
      // each phone check takes 31 s; after the first one another machine grabs the lease
      phoneReply: (row) => { clock.t += 31 * S; if (row?.id === "r1") steal(lease, clock); return { status: "ok" }; } });
    await w.booted;
    await w.sb.pcTick();
    expect(w.calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && m.rowId).map((m) => m.rowId)).toEqual(["r1"]);
    expect(w.status().leaseRole).toBe("standby");
    expect(w.calls.logs.some((l) => /no longer the leader — stopping this pass/.test(l))).toBe(true);
  });

  // The pass starts as leader; between pcPoll's lease call and pcPollMulti the lease moves
  // (31 s pass) → the re-check at the top of pcPollMulti must stop everything after it.
  const lostBeforeMulti = async (lose: boolean) => {
    const clock = { t: T0 };
    const lease = leaseServer(clock);
    let armed = false;
    const w = bootWorker({ now: () => clock.t, emapTab: false,
      lease: (b) => { const r = lease.handler(b); if (lose && count(w.calls, /admin_parcel_worker_lease/) === 1) armed = true; return r; },
      // the next SFL_GET_TOKEN after that lease call is pcPollMulti's
      sflToken: () => { if (armed) { armed = false; clock.t += 31 * S; steal(lease, clock); } return fakeJwt(); } });
    await w.booted;
    await w.sb.pcTick();
    return w;
  };
  it("M1: the role lost between pcPoll and pcPollMulti → no probe, no pending read, no re-mint, no state push", async () => {
    const control = (await lostBeforeMulti(false)).calls;
    expect(count(control, /admin_parcel_check_config/)).toBe(1);
    expect(pendingReads(control)).toBe(1);
    expect(clicks(control)).toBe(1);
    expect(count(control, /admin_set_parcel_worker_state/)).toBe(1);
    const lostW = await lostBeforeMulti(true);
    const lost = lostW.calls;
    expect(lostW.status().leaseRole).toBe("standby");
    expect(count(lost, /admin_parcel_check_config/)).toBe(0);
    expect(pendingReads(lost)).toBe(0);
    expect(clicks(lost)).toBe(0);
    expect(count(lost, /admin_set_parcel_worker_state/)).toBe(0);
  });

  it("M1: the requeue is gated on the CURRENT lease too", async () => {
    const run = async (lose: boolean) => {
      const clock = { t: Date.UTC(2026, 0, 14, 20, 59, 50) };   // 04:59:50 Taipei — inside the window
      const lease = leaseServer(clock);
      let armed = false;
      const w = bootWorker({ now: () => clock.t, rows: [], maintenance: true,
        lease: (b) => { const r = lease.handler(b); if (lose && count(w.calls, /admin_parcel_worker_lease/) === 2) armed = true; return r; },
        sflToken: () => { if (armed) { armed = false; clock.t += 31 * S; steal(lease, clock); } return fakeJwt(); } });
      await w.booted;
      await w.sb.pcTick();             // inside the window
      clock.t += 20 * S;               // 05:00:10 → the window just ended → a requeue is owed this pass
      await w.sb.pcTick();
      return count(w.calls, /admin_parcel_check_requeue/);
    };
    expect(await run(false)).toBe(1);
    expect(await run(true)).toBe(0);
  });

  it("a lease error keeps the last role (leader keeps working inside 60 s; standby stays standby)", async () => {
    const { clock, a, b, lease } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    lease.st.down = true;
    clock.t += 5 * S;
    const aPending = pendingReads(a.calls);
    await a.sb.pcTick(); await b.sb.pcTick();
    expect(a.status().leaseRole).toBe("leader");
    expect(pendingReads(a.calls)).toBe(aPending + 1);          // still on duty
    expect(b.status().leaseRole).toBe("standby");
    expect(forbiddenFetches(b.calls)).toEqual([]);             // still waiting
    expect(a.calls.logs.filter((l) => /lease call failed/.test(l)).length).toBe(1);
  });

  it("…but never acts on a lease older than 60 s (until the 3-min fail-open)", async () => {
    const { clock, a, lease } = await twoWorkers();
    await a.sb.pcTick();
    lease.st.down = true;
    clock.t += 61 * S;
    const before = forbiddenFetches(a.calls).length;
    await a.sb.pcTick();
    expect(forbiddenFetches(a.calls).length).toBe(before);
    expect(a.status().leaseRole).toBe("leader"); // the role is kept — it just may not act on it
  });

  it("M2: lease unreachable 3+ min → BOTH act as leader (logged once); back to one leader when it answers", async () => {
    const { clock, a, b, lease } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    lease.st.down = true;
    for (let i = 0; i < 7; i++) { clock.t += 30 * S; await a.sb.pcTick(); await b.sb.pcTick(); } // 3+ min failing
    const aBefore = pendingReads(a.calls), bBefore = pendingReads(b.calls);
    clock.t += 5 * S; await a.sb.pcTick(); await b.sb.pcTick();
    expect(pendingReads(a.calls)).toBe(aBefore + 1);
    expect(pendingReads(b.calls)).toBe(bBefore + 1);      // the standby acts as leader too (may double-check)
    expect(b.calls.logs.filter((l) => /lease unreachable for 3\+ min — acting as leader/.test(l)).length).toBe(1);
    expect(b.status().leaseFailOpen).toBe(true);
    expect(b.status().leaseFailing).toBe(true);
    lease.st.down = false;
    clock.t += 5 * S; await a.sb.pcTick(); await b.sb.pcTick();
    expect(b.calls.logs.some((l) => /lease reachable again/.test(l))).toBe(true);
    const bAfter = forbiddenFetches(b.calls).length;
    clock.t += 5 * S; await a.sb.pcTick(); await b.sb.pcTick();
    expect(a.status().leaseRole).toBe("leader");
    expect(b.status().leaseRole).toBe("standby");
    expect(b.status().leaseFailing).toBe(false);
    expect(b.status().leaseFailOpen).toBe(false);
    expect(forbiddenFetches(b.calls).length).toBe(bAfter);
  });

  it("boot with a lease error (network / non-200 / bad JSON) acts as leader — today's behaviour", async () => {
    for (const lease of [() => "throw" as const, () => ({ status: 500, json: { message: "boom" } }), () => ({ json: { nope: true } })]) {
      const w = bootWorker({ lease });
      await w.booted;
      await w.sb.pcTick();
      expect(pendingReads(w.calls)).toBe(1);
      expect(verdicts(w.calls)).toBe(1);
      expect(w.status().leaseRole).toBe(null);
      expect(w.status().leaseFailing).toBe(true);
    }
  });

  it("a lease error never throws out of the loop (the next tick is still scheduled)", async () => {
    const w = bootWorker({ lease: () => "throw" });
    await w.booted;
    await expect(w.sb.pcTick()).resolves.not.toThrow();
    expect(w.calls.scheduled).toContain(5000);
  });

  it("L3: a hung lease call times out after 8 s and the pass carries on", async () => {
    const w = bootWorker({ lease: () => "hang" });
    await w.booted;
    const tick = w.sb.pcTick();
    let fired = false;
    for (let i = 0; i < 500 && !fired; i++) {
      await new Promise((r) => setImmediate(r));
      const t = w.calls.timers.find((x) => x.ms === 8000);
      if (t) { t.fn(); fired = true; }
    }
    expect(fired).toBe(true);
    await tick;
    expect(w.calls.logs.some((l) => /lease call failed \(timeout 8s\)/.test(l))).toBe(true);
    expect(pendingReads(w.calls)).toBe(1);   // no answer since boot → pre-1.15 behaviour, the pass still worked
    expect(w.calls.scheduled).toContain(5000);
  });
});

describe("the three gates the first audit found untested", () => {
  it("re-mint is leader-only: a standby with a dead E-Map never clicks 選擇取貨門市", async () => {
    const { clock, a, b } = await twoWorkers([], {}, { emapTab: false });
    for (let i = 0; i < 4; i++) { await a.sb.pcTick(); await b.sb.pcTick(); clock.t += 5 * S; }
    expect(b.status().leaseRole).toBe("standby");
    expect(clicks(b.calls)).toBe(0);
    const solo = bootWorker({ emapTab: false, rows: [] });    // control: a lone leader does click
    await solo.booted; await solo.sb.pcTick();
    expect(clicks(solo.calls)).toBe(1);
  });

  it("legacy lane: the standby returns before its fetch (no GET parcel_scans); the leader fetches", async () => {
    const { clock, a, b } = await twoWorkers([], { multiSeller: false }, { multiSeller: false });
    for (let i = 0; i < 3; i++) { await a.sb.pcTick(); await b.sb.pcTick(); clock.t += 5 * S; }
    expect(count(a.calls, /rest\/v1\/parcel_scans/)).toBeGreaterThan(0);
    expect(count(b.calls, /rest\/v1\/parcel_scans/)).toBe(0);
  });

  it("legacy lane: losing the lease mid-pass stops before the next row", async () => {
    const clock = { t: T0 };
    const lease = leaseServer(clock);
    const legacyRows = ["L1", "L2", "L3"].map((id) => ({ id, phone: "0912345678", store_id: "195965", customer_name: "x" }));
    const w = bootWorker({ now: () => clock.t, multiSeller: false, legacyRows, lease: lease.handler,
      phoneReply: (row) => { clock.t += 31 * S; if (row?.id === "L1") steal(lease, clock); return { status: "ok" }; } });
    await w.booted;
    await w.sb.pcTick();
    expect(w.calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE").map((m) => m.rowId)).toEqual(["L1"]);
    expect(w.status().leaseRole).toBe("standby");
  });
});

describe("identity, worker-state blob, writes outside a pass", () => {
  it("the leader's blob carries wid + label + multi + degraded + leaseFailing (the rest is unchanged)", async () => {
    const { clock, a, b } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    clock.t += 5 * S; await a.sb.pcTick();
    const i = a.calls.fetch.findIndex((u) => /admin_set_parcel_worker_state/.test(u));
    expect(i).toBeGreaterThan(-1);
    const state = JSON.parse(a.calls.fetchBodies[i]).p_state;
    expect(state.wid).toBe((a.storage.pc_worker as { id: string }).id);
    expect(state).toMatchObject({ label: "Windows laptop", multi: true, degraded: false, leaseFailing: false });
    expect(Object.keys(state).sort()).toEqual(["at", "bootAt", "degraded", "emap", "emapDomain", "inMaintenanceWindow", "label", "lastGiveUpAt",
      "lastPhoneVerdictAt", "lastStoreMissAt", "lastStoreVerdictAt", "leaseFailing", "multi", "myship", "queue", "sfl", "v", "wid"]);
    expect(leaseBodies(a.calls)[0].p_state).toMatchObject({ multi: true, degraded: false, leaseFailing: false });
    expect(b.calls.fetch.some((u) => /admin_set_parcel_worker_state/.test(u))).toBe(false);
  });

  it("Multi-seller off travels as multi:false (the server never yields to it)", async () => {
    const w = bootWorker({ multiSeller: false, lease: leaseServer({ t: T0 }).handler });
    await w.booted; await w.sb.pcTick();
    expect(leaseBodies(w.calls)[0].p_state.multi).toBe(false);
  });

  it("the worker id is generated once and survives a restart; label = Device name, else platform + id prefix", async () => {
    const lease = leaseServer({ t: T0 });
    const ids: string[] = [];
    const first = bootWorker({ lease: (b) => { ids.push(b.p_worker_id); return lease.handler(b); } });
    await first.booted; await first.sb.pcTick();
    const saved = first.storage.pc_worker as { id: string };
    expect(saved.id).toBe(ids[0]);
    const labels: string[] = [];
    const again = bootWorker({ initialStorage: { pc_worker: saved }, lease: (b) => { ids.push(b.p_worker_id); labels.push(b.p_label); return lease.handler(b); } });
    await again.booted; await again.sb.pcTick();
    expect(ids[1]).toBe(saved.id);
    expect(labels[0]).toBe(`Device ${saved.id.slice(0, 4)}`); // no Device name, no platform API in the harness
  });

  it("a STANDBY still syncs its own Pickup Status: PC_ORDER_ROWS + PC_EXPORT_HANDLES upsert (not duty work)", async () => {
    const { a, b } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    expect(b.status().leaseRole).toBe("standby");
    const listeners = (b.sb.chrome.runtime.onMessage.addListener as unknown as { mock: { calls: [(m: unknown, s: unknown, r: (x: unknown) => void) => boolean][] } }).mock.calls.map((c) => c[0]);
    const before = count(b.calls, /rest\/v1\/parcel_tracking/);
    for (const type of ["PC_ORDER_ROWS", "PC_EXPORT_HANDLES"]) {
      const reply = await new Promise((resolve) => { for (const l of listeners) l({ type, rows: [{ tracking_no: "F1", buyer_username: "x" }] }, {}, resolve); });
      expect(reply).toMatchObject({ ok: true, upserted: 1 });
    }
    expect(count(b.calls, /rest\/v1\/parcel_tracking/)).toBe(before + 2);
  });

  it("[PC-TICK] carries the role; role changes log exactly one [PC-LEASE] line (no per-tick spam)", async () => {
    const { clock, a, b } = await twoWorkers();
    for (let i = 0; i < 13; i++) { await a.sb.pcTick(); await b.sb.pcTick(); clock.t += 5 * S; }
    expect(a.calls.logs.some((l) => /\[PC-TICK\] #1 role=leader/.test(l))).toBe(true);
    expect(b.calls.logs.some((l) => /\[PC-TICK\] #1 role=standby/.test(l))).toBe(true);
    expect(leaseLogs(a.calls).length).toBe(1);
    expect(leaseLogs(b.calls).length).toBe(1);
  });

  it("version pin: manifest 1.15.0", () => {
    expect(JSON.parse(readFileSync("chrome-extension/manifest.json", "utf8")).version).toBe("1.15.0");
  });
});
