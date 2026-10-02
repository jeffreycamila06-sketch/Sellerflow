// 1.15.0 — TWO-MACHINE FAILOVER. Two real background.js workers (shared vm harness) run
// against ONE fake lease that mirrors sql/71 (calling it IS the renewal; leader silent
// > 120 s → the other takes over; no preferred machine). Only the leader may make the
// side-effecting calls; the standby only keeps its tabs ready (pick + keepalive + status).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei — outside the maintenance window

type Body = { p_worker_id: string; p_label: string; p_state: Record<string, unknown> };
// The sql/71 rules on a shared test clock.
function leaseServer(clock: { t: number }) {
  const st = { leaderId: null as string | null, leaderLabel: null as string | null, leaderAt: 0, takeovers: 0, down: false, standby: null as null | { id: string; state: Record<string, unknown> } };
  const handler = (b: Body) => {
    if (st.down) return "throw" as const;
    const fresh = st.leaderId !== null && clock.t - st.leaderAt < 120 * S;
    if (fresh && st.leaderId !== b.p_worker_id) {
      st.standby = { id: b.p_worker_id, state: b.p_state };
      return { json: { leader: false, reason: "leader_alive", leader_id: st.leaderId, leader_label: st.leaderLabel, leader_age_s: Math.round((clock.t - st.leaderAt) / S), ttl_s: 120 } };
    }
    if (st.leaderId !== b.p_worker_id) st.takeovers += 1;
    st.leaderId = b.p_worker_id; st.leaderLabel = b.p_label; st.leaderAt = clock.t;
    if (st.standby && st.standby.id === b.p_worker_id) st.standby = null;
    return { json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: b.p_label, leader_age_s: 0, ttl_s: 120 } };
  };
  return { st, handler };
}

type Calls = ReturnType<typeof bootWorker>["calls"];
// Every network / DB side effect the STANDBY must never make.
const FORBIDDEN = [/admin_parcel_checks_pending/, /admin_parcel_check_config/, /admin_set_parcel_sender_health/, /admin_parcel_check_verdict/,
  /admin_parcel_check_requeue/, /admin_set_parcel_worker_state/, /rest\/v1\/parcel_scans/, /rest\/v1\/parcel_tracking/];
const forbiddenFetches = (c: Calls) => c.fetch.filter((u) => FORBIDDEN.some((re) => re.test(u)));
const rowChecks = (c: Calls) => c.sendMessage.filter((m) => (m.type === "PC_CHECK_PHONE") || (m.type === "PC_CHECK_STORE" && m.rowId));
const pendingReads = (c: Calls) => c.fetch.filter((u) => /admin_parcel_checks_pending/.test(u)).length;
const verdicts = (c: Calls) => c.fetch.filter((u) => /admin_parcel_check_verdict/.test(u)).length;
const leaseLogs = (c: Calls) => c.logs.filter((l) => /\[PC-LEASE\]/.test(l));

async function twoWorkers(rows: unknown[] = [PENDING_ROW]) {
  const clock = { t: T0 };
  const lease = leaseServer(clock);
  const a = bootWorker({ now: () => clock.t, rows, lease: lease.handler, config: { deviceName: "Windows laptop" } });
  const b = bootWorker({ now: () => clock.t, rows, lease: lease.handler, config: { deviceName: "Mac" } });
  await a.booted; await b.booted;
  return { clock, lease, a, b };
}

describe("two workers, one lease", () => {
  it("only the leader reads pending / checks / writes; the standby makes NONE of the forbidden calls", async () => {
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
    expect(b.calls.fetch.filter((u) => /admin_parcel_worker_lease/.test(u)).length).toBe(6);
    expect(lease.st.standby?.state).toMatchObject({ v: "test", sfl: expect.anything() });
    expect(b.status().leaseLeaderLabel).toBe("Windows laptop");
  });

  it("the standby keeps the E-Map session alive (keepalive is a both-roles job)", async () => {
    const { clock, a, b } = await twoWorkers([]);
    await a.sb.pcTick(); await b.sb.pcTick();
    clock.t += 5 * 60 * S + S;
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
});

describe("long passes + lease failures", () => {
  it("a leader that gets leader:false mid-pass stops before the next row", async () => {
    const clock = { t: T0 };
    const lease = leaseServer(clock);
    const rows = ["r1", "r2", "r3"].map((id) => ({ ...PENDING_ROW, id, need_store: false }));
    const w = bootWorker({ now: () => clock.t, rows, lease: lease.handler,
      // each phone check takes 31 s; after the first one another machine grabs the lease
      phoneReply: (row) => { clock.t += 31 * S; if (row?.id === "r1") { lease.st.leaderId = "other"; lease.st.leaderLabel = "Mac"; lease.st.leaderAt = clock.t; } return { status: "ok" }; } });
    await w.booted;
    await w.sb.pcTick();
    const checked = w.calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && m.rowId).map((m) => m.rowId);
    expect(checked).toEqual(["r1"]);
    expect(w.status().leaseRole).toBe("standby");
    expect(w.calls.logs.some((l) => /stopping this pass before the next row/.test(l))).toBe(true);
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

  it("…but never acts on a lease older than 60 s (the other machine may already be on duty)", async () => {
    const { clock, a, lease } = await twoWorkers();
    await a.sb.pcTick();
    lease.st.down = true;
    clock.t += 61 * S;
    const before = forbiddenFetches(a.calls).length;
    await a.sb.pcTick();
    // nothing leader-only at all: no pending read, no checks, no verdict, no state push, no requeue
    expect(forbiddenFetches(a.calls).length).toBe(before);
    expect(a.status().leaseRole).toBe("leader"); // the role is kept — it just may not act on it
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
});

describe("identity, worker-state blob, writes outside a pass", () => {
  it("the leader's worker-state blob carries wid + label (and nothing else changes)", async () => {
    const { clock, a, b } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    clock.t += 5 * S; await a.sb.pcTick();
    const i = a.calls.fetch.findIndex((u) => /admin_set_parcel_worker_state/.test(u));
    expect(i).toBeGreaterThan(-1);
    const state = JSON.parse(a.calls.fetchBodies[i]).p_state;
    expect(state.wid).toBe(a.storage.pc_worker && (a.storage.pc_worker as { id: string }).id);
    expect(state.label).toBe("Windows laptop");
    expect(Object.keys(state).sort()).toEqual(["at", "bootAt", "emap", "emapDomain", "inMaintenanceWindow", "label", "lastGiveUpAt", "lastPhoneVerdictAt", "lastStoreMissAt", "lastStoreVerdictAt", "myship", "queue", "sfl", "v", "wid"]);
    expect(b.calls.fetch.some((u) => /admin_set_parcel_worker_state/.test(u))).toBe(false);
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

  it("standby never upserts tracking / handles (PC_ORDER_ROWS, PC_EXPORT_HANDLES)", async () => {
    const { a, b } = await twoWorkers();
    await a.sb.pcTick(); await b.sb.pcTick();
    const listeners = (b.sb.chrome.runtime.onMessage.addListener as unknown as { mock: { calls: [(m: unknown, s: unknown, r: (x: unknown) => void) => boolean][] } }).mock.calls.map((c) => c[0]);
    for (const type of ["PC_ORDER_ROWS", "PC_EXPORT_HANDLES"]) {
      const reply = await new Promise((resolve) => { for (const l of listeners) l({ type, rows: [{ tracking_no: "F1", buyer_username: "x" }] }, {}, resolve); });
      expect(reply).toEqual({ ok: false, reason: "standby" });
    }
    expect(b.calls.fetch.some((u) => /parcel_tracking/.test(u))).toBe(false);
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
