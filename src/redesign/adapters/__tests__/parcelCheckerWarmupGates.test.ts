// 1.18.1 — REAL PARCELS ALWAYS FIRST: the two extra warm-up gates in chrome-extension/frozen-check.js.
//   (b) FRESH READ: no warm-up request unless the dry lane's pending read ran in THIS pass (pc_status.multiLastAt
//       later than the previous kick). A pass that skipped its read (the SFL token missing for the dry lane, a
//       lease re-check, no SFL tab) leaves the previous "queue 0" in pc_status → no warm-up.
//   (a) GIVEN-UP ROWS: no warm-up while admin_parcel_gave_up_count (sql/147) says > 0, or cannot be read, or the
//       read is older than 90 s; a give-up seen in this worker also holds it 60 s and until a read ≥ 30 s after it.
// Plus: every warm-up send logs `queue=<n>` (the post-deploy "must be 0" check).
// Sabotage: SFL_EXT_DIR=<patched copy> runs these against a broken frozen-check.js (see the report).
import { describe, it, expect } from "vitest";
import { bootWorker, fakeJwt } from "./parcelCheckerHarness";

const S = 1000;
const MIN = 60 * S;
const T0 = Date.UTC(2026, 0, 15, 2, 0, 0);  // 10:00 Taipei
const TN = Date.UTC(2026, 0, 15, 17, 30, 0); // 01:30 Taipei (maintenance window — warm-up night probes)
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
type W = ReturnType<typeof bootWorker>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "test", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function storeList(n: number, done: Set<string>) {
  const all = Array.from({ length: n }, (_, i) => String(600001 + i));
  return (body: Record<string, unknown>) => {
    const left = all.filter((s) => !done.has(s));
    return left.slice(0, Number(body.p_limit) || 1).map((s) => ({ store_id: s, frozen_history: false, parcels: 1, left_count: left.length, checked_count: done.size }));
  };
}
const warmMsgs = (w: W) => w.calls.sendMessage.filter((m) => m.type === "PC_FROZEN_CHECK" && String(m.rowId ?? "").startsWith("warmup:"));
const count = (w: W, re: RegExp) => w.calls.fetch.filter((u) => re.test(u)).length;
const PENDING = /admin_parcel_checks_pending/;
const GAVE_UP = /admin_parcel_gave_up_count/;

// a world where the warm-up runs; `at` = clock of each warm-up request; tok.skip = the dry lane's token read fails
function world(extra: Partial<Opts> = {}, t0 = T0) {
  const clock = { t: t0 };
  const done = new Set<string>(); const at: number[] = [];
  const tok = { skip: false, n: 0 };
  const opts: Opts = {
    rows: [], lease: LEADER, frozenSwitch: "true", frozenPending: [], warmupSwitch: "true", warmupNext: storeList(200, done),
    // per pass: call 1 = pcPoll's token ladder (lease), call 2 = pcPollMulti's token for the pending read
    sflToken: () => { tok.n += 1; return tok.skip && tok.n === 2 ? null : fakeJwt(); },
    frozenReply: (row) => { at.push(clock.t); done.add(String(row?.store_id)); return { frozen_store_status: "ok", frozen_reason: "", transient: false }; },
    ...extra,
  };
  if (t0 === TN) opts.maintenance = true;
  opts.now = () => clock.t;
  return { opts, clock, at, tok };
}
async function boot(wd: ReturnType<typeof world>) {
  const w = bootWorker(wd.opts);
  await w.booted;
  return w;
}
async function pass(w: W, wd: ReturnType<typeof world>) { wd.tok.n = 0; await w.sb.pcTick(); await flush(); wd.clock.t += 5 * S; }
async function passes(w: W, wd: ReturnType<typeof world>, n: number) { for (let i = 0; i < n; i++) await pass(w, wd); }

// run until the warm-up is due again (≥ 60 s after its last request), so the next pass would send
async function untilDue(w: W, wd: ReturnType<typeof world>) {
  for (let i = 0; i < 40 && !(wd.at.length && wd.clock.t - wd.at[wd.at.length - 1] >= 60 * S); i++) await pass(w, wd);
}

describe("(b) fresh read — no warm-up unless THIS pass read the pending queue", () => {
  it("baseline: the token trick only skips the dry lane's pending read (one read per pass otherwise); warm-up runs", async () => {
    const wd = world(); const w = await boot(wd);
    await passes(w, wd, 4);
    const r0 = count(w, PENDING);
    expect(r0).toBe(4);
    wd.tok.skip = true; await passes(w, wd, 3);
    expect(count(w, PENDING)).toBe(r0);                                   // 3 passes, no pending read
    wd.tok.skip = false; await passes(w, wd, 30);
    expect(wd.at.length).toBeGreaterThanOrEqual(2);
  });
  it("passes that skip the pending read (pc_status still says queue 0, < 30 s old) → NO warm-up request; reads back → it resumes", async () => {
    const wd = world(); const w = await boot(wd);
    await passes(w, wd, 20); await untilDue(w, wd);
    const before = wd.at.length; expect(before).toBeGreaterThanOrEqual(1);
    const r0 = count(w, PENDING);
    wd.tok.skip = true; await passes(w, wd, 5);                            // 25 s: the stale "0" is still < 30 s old for most of them
    expect(count(w, PENDING)).toBe(r0);
    expect(wd.at.length).toBe(before);                                    // 1.18.0 sent here — 1.18.1 does not
    expect(w.calls.logs.some((l) => /warm-up held: no pending read in this pass/.test(l))).toBe(true);
    wd.tok.skip = false; await passes(w, wd, 3);
    expect(wd.at.length).toBe(before + 1);                                // the next pass that reads → the warm-up goes
  });
  it("night: the same — a pass that skipped the read → no night probe", async () => {
    const wd = world({}, TN); const w = await boot(wd);
    await passes(w, wd, 20); await untilDue(w, wd);
    const before = wd.at.length; expect(before).toBeGreaterThanOrEqual(1);
    wd.tok.skip = true; await passes(w, wd, 5);
    expect(wd.at.length).toBe(before);
    wd.tok.skip = false; await passes(w, wd, 3);
    expect(wd.at.length).toBe(before + 1);
  });
  it("the pure check: a read not later than minReadAt → 'no pending read in this pass'; later → idle", async () => {
    const wd = world(); const w = await boot(wd);
    await passes(w, wd, 2);
    const t = w.evalIn("pcFrozenKick.__test") as { dryState: (m?: number) => Promise<string> };
    const at = Date.parse(String((w.storage.pc_status as Record<string, unknown>).multiLastAt));
    expect(await t.dryState(at)).toBe("no pending read in this pass");
    expect(await t.dryState(at - 1)).toBe("");
    expect(await t.dryState()).toBe("");                                  // the store-list read keeps the old rule
  });
});

describe("(a) given-up rows — no warm-up while any parcel waits for the re-queue", () => {
  it("gave-up count 2 → no warm-up for 10 min; the count is read ≤ once a minute; the reason is logged", async () => {
    const wd = world({ gaveUp: 2 }); const w = await boot(wd);
    await passes(w, wd, 12 * 10);
    expect(wd.at).toEqual([]);
    expect(count(w, GAVE_UP)).toBeGreaterThanOrEqual(8);
    expect(count(w, GAVE_UP)).toBeLessThanOrEqual(11);
    expect(w.calls.logs.some((l) => /warm-up held: 2 given-up parcel\(s\) wait for the re-queue/.test(l))).toBe(true);
  });
  for (const bad of ["error", "throw"] as const) {
    it(`the count cannot be read (${bad}) → no warm-up (fail-closed); real frozen parcels still go out`, async () => {
      const wd = world({ gaveUp: bad, frozenPending: [{ id: "fz-1", store_id: "968551", queue_depth: 1 }] }); const w = await boot(wd);
      await passes(w, wd, 12 * 5);
      expect(warmMsgs(w)).toEqual([]);
      expect(w.calls.sendMessage.some((m) => m.type === "PC_FROZEN_CHECK" && m.rowId === "fz-1")).toBe(true);
    });
  }
  it("count 2 → 0 → the warm-up resumes within ~2 min", async () => {
    const g = { n: 2 };
    const wd = world({ gaveUp: () => g.n }); const w = await boot(wd);
    await passes(w, wd, 12 * 3);
    expect(wd.at).toEqual([]);
    const t0 = wd.clock.t; g.n = 0;
    await passes(w, wd, 12 * 3);
    expect(wd.at.length).toBeGreaterThanOrEqual(1);
    expect(wd.at[0] - t0).toBeLessThanOrEqual(2 * MIN);
  });
  it("a give-up in THIS worker (pcEv.lastGiveUpAt) holds the warm-up ≥ 60 s and until a read ≥ 30 s after it", async () => {
    const wd = world(); const w = await boot(wd);
    await passes(w, wd, 20); await untilDue(w, wd);
    const before = wd.at.length;
    const gu = wd.clock.t;
    w.evalIn(`pcEv.lastGiveUpAt = ${gu};`);
    await passes(w, wd, 12);                                              // 60 s
    expect(wd.at.length).toBe(before);
    await passes(w, wd, 12 * 3);
    expect(wd.at.length).toBeGreaterThan(before);
    const reads = (w.evalIn("pcFrozenKick.__test.warm.gaveUp") as { at: number }).at;
    expect(wd.at[before]).toBeGreaterThanOrEqual(gu + MIN);
    expect(reads).toBeGreaterThanOrEqual(gu + 30 * S);
  });
  it("night: count 1 → no night probe", async () => {
    const wd = world({ gaveUp: 1 }, TN); const w = await boot(wd);
    await passes(w, wd, 12 * 5);
    expect(wd.at).toEqual([]);
  });
  it("frozen switch OFF, or warm-up switch off → the count is never read", async () => {
    for (const extra of [{ frozenSwitch: "false" }, { warmupSwitch: "false" }] as Partial<Opts>[]) {
      const wd = world(extra); const w = await boot(wd);
      await passes(w, wd, 12 * 3);
      expect(count(w, GAVE_UP)).toBe(0);
      expect(wd.at).toEqual([]);
    }
  });
  it("the pure check: unread / failed / >0 / older than 90 s / within 60 s of a give-up / read before give-up+30 s → held", async () => {
    const wd = world(); const w = await boot(wd);
    const t = w.evalIn("pcFrozenKick.__test") as { gaveUpClear: (n: number) => boolean; warm: { gaveUp: { ok: boolean; n: number | null; at: number } } };
    const now = 10_000_000;
    const set = (ok: boolean, n: number | null, at: number, gu = 0) => { t.warm.gaveUp = { ok, n, at }; w.evalIn(`pcEv.lastGiveUpAt = ${gu};`); };
    set(true, 0, now - 10 * S); expect(t.gaveUpClear(now)).toBe(true);
    set(false, null, now); expect(t.gaveUpClear(now)).toBe(false);
    set(true, 1, now); expect(t.gaveUpClear(now)).toBe(false);
    set(true, 0, now - 91 * S); expect(t.gaveUpClear(now)).toBe(false);
    set(true, 0, now, now - 59 * S); expect(t.gaveUpClear(now)).toBe(false);
    set(true, 0, now - 10 * S, now - 61 * S); expect(t.gaveUpClear(now)).toBe(true);    // give-up 61 s ago, read 51 s after it → clear
    set(true, 0, now - 41 * S, now - 61 * S); expect(t.gaveUpClear(now)).toBe(false);   // read only 20 s after the give-up → may predate its write
  });
});

describe("post-deploy check — every warm-up send says queue=0", () => {
  it("each warm-up request is logged with queue=0, the read age and gaveUp=0", async () => {
    const wd = world(); const w = await boot(wd);
    await passes(w, wd, 12 * 4);
    const sends = w.calls.logs.filter((l) => /\[PC-WARMUP\] warm-up send store=/.test(l));
    expect(sends.length).toBe(wd.at.length);
    expect(sends.length).toBeGreaterThanOrEqual(3);
    for (const l of sends) expect(l).toMatch(/queue=0 read=\d+ms gaveUp=0$/);
  });
});

describe("the last look right before the send", () => {
  it("a dry parcel shows up between the first check and the send (pc_status queue 2) → no warm-up request", async () => {
    const ref: { w: W | null; arm: boolean } = { w: null, arm: false };
    const wd = world({ onFrozenPing: () => { if (ref.arm && ref.w) (ref.w.storage.pc_status as Record<string, unknown>).multiQueueDepth = 2; } });
    const w = await boot(wd); ref.w = w;
    await passes(w, wd, 20); await untilDue(w, wd);
    const before = wd.at.length; expect(before).toBeGreaterThanOrEqual(1);
    ref.arm = true; await pass(w, wd); ref.arm = false;
    expect(wd.at.length).toBe(before);
    expect(w.calls.logs.some((l) => /warm-up held at the send: dry queue 2/.test(l))).toBe(true);
  });
  it("…and a give-up between the first check and the send → no warm-up request", async () => {
    const ref: { w: W | null; arm: boolean } = { w: null, arm: false };
    const wd = world({ onFrozenPing: () => { if (ref.arm && ref.w) ref.w.evalIn(`pcEv.lastGiveUpAt = Date.now();`); } });
    const w = await boot(wd); ref.w = w;
    await passes(w, wd, 20); await untilDue(w, wd);
    const before = wd.at.length;
    ref.arm = true; await pass(w, wd); ref.arm = false;
    expect(wd.at.length).toBe(before);
  });
});
