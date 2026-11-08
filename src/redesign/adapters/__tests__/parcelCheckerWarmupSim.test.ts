// 1.18.0 WARM-UP under REALISTIC timing (parcelCheckerHarness sim mode — the real worker on a virtual
// clock: E-Map 0.8 / 2 / 8 s, myship 1.5 s, database 150 ms). 60 virtual minutes, 3 dry parcels
// queued at the start and 25 more ARRIVING throughout (bursts and gaps), 200 stores to warm.
// Warm-up ON vs OFF, same clock, same arrivals:
//   • the dry lane is request-for-request identical (every E-Map / myship request at the same time)
//     and every dry verdict lands at the same time → real parcels are never delayed;
//   • 0 overlaps on the E-Map session, both ways (warm-up counts as a frozen-kind request);
//   • no warm-up request starts while a dry parcel is waiting that the lane already knew about
//     (= read in a pending read before the request), and a parcel arriving during a warm-up check
//     waits at most for that one check (≤ 3 s);
//   • warm-up requests are ≥ 60 s apart, and stop entirely while dry work is queued.
import { describe, it, expect } from "vitest";
import { appendFileSync } from "node:fs";
import { bootWorker, makeSim, runSim, simOverlaps, type Sim } from "./parcelCheckerHarness";

const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei
const MIN = 60_000;
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "sim", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const STORES = Array.from({ length: 200 }, (_, i) => String(700001 + i));
// arrivals (ms after T0): a burst at 4 min, singles, a burst at 25 min, a quiet stretch, late singles
const ARRIVALS = [4, 4.1, 4.2, 4.3, 4.4, 9, 13.5, 17, 25, 25.05, 25.1, 25.15, 25.2, 25.25, 25.3, 31, 38.2, 44.4, 44.5, 49, 52.7, 55, 57.5, 58, 59].map((m) => Math.round(m * MIN));

async function simRun(emapMs: number, warm: boolean, alarmMs = 0): Promise<Sim> {
  const sim = makeSim({ t0: T0, emapMs, dry: 3, frozen: [], warmupSwitch: warm ? "true" : "false", warmStores: STORES, arrivals: ARRIVALS });
  const w = bootWorker({ sim, lease: LEADER });
  await w.booted;
  await runSim(sim, T0 + 60 * MIN, alarmMs);
  return sim;
}
const dryLane = (s: Sim) => s.intervals.filter((i) => i.kind !== "frozen").map((i) => `${i.kind}:${i.rowId ?? ""}@${i.start}`);
const warmIv = (s: Sim) => s.intervals.filter((i) => i.kind === "frozen" && String(i.rowId).startsWith("warmup:"));

describe("warm-up never delays a real parcel (dry lane identical ON vs OFF)", () => {
  for (const [emapMs, alarmMs] of [[800, 0], [2000, 0], [8000, 0], [800, 30_000], [2000, 30_000]] as const) {
    it(`E-Map ${emapMs} ms${alarmMs ? " + the 30 s alarm" : ""}: same dry requests and verdicts at the same times; 0 overlaps; warm-up paced and only when idle`, async () => {
      const on = await simRun(emapMs, true, alarmMs);
      const off = await simRun(emapMs, false, alarmMs);
      // 1. the dry lane is untouched
      expect(dryLane(on)).toEqual(dryLane(off));
      expect(on.normalVerdicts).toEqual(off.normalVerdicts);
      expect(new Set(on.normalVerdicts.map((v) => v.id)).size).toBe(3 + ARRIVALS.length); // every parcel got its verdict (the 30 s alarm can make main check one twice — same ON and OFF)
      // 2. no overlap on the shared E-Map session
      const o = simOverlaps(on.intervals);
      expect(o.frozenDuringNormal).toBe(0);
      expect(o.normalDuringFrozen).toBe(0);
      expect(o.normalNormal).toBe(simOverlaps(off.intervals).normalNormal);  // main's own (alarm) overlaps, unchanged
      // 3. warm-up ran, paced ≥ 60 s
      const wi = warmIv(on);
      if (emapMs <= 2500) expect(wi.length).toBeGreaterThan(10);
      for (let i = 1; i < wi.length; i++) expect(wi[i].start - wi[i - 1].start).toBeGreaterThanOrEqual(60_000);
      expect(off.warmVerdicts).toEqual([]);
      // 4. never while known dry work waits: at each warm-up start, every dry parcel that had arrived
      //    ≥ 30 s earlier (so a pending read saw it) was already answered
      for (const w of wi) {
        const known = Object.entries(on.arrivedAt).filter(([, t]) => t <= w.start - 30_000).map(([id]) => id);
        const answered = new Set(on.normalVerdicts.filter((v) => v.t <= w.start).map((v) => v.id));
        expect(known.filter((id) => !answered.has(id)), `warm-up at ${w.start - T0} ms`).toEqual([]);
      }
      // 5. a parcel answered after a warm-up check: its own row check never STARTED while that check was open
      for (const n of on.intervals.filter((i) => i.kind === "normal")) for (const w of wi) expect(w.start <= n.start && n.start < w.end).toBe(false);
      if (process.env.SFL_SIM_REPORT) appendFileSync(process.env.SFL_SIM_REPORT, `[WARMUP-SIM] emap=${emapMs} alarm=${alarmMs} warmChecks=${wi.length} warmAnswered=${on.warmVerdicts.filter((v) => v.status !== "unknown").length} dryVerdicts=${on.normalVerdicts.length}\n`);
    }, 180_000);
  }
});

describe("warm-up with a slow E-Map", () => {
  it("E-Map 8 s: every warm-up check is a no-answer → 3, a 30-min pause, 3 more → STOP (≤ 6 checks in 60 min, nothing written)", async () => {
    const on = await simRun(8000, true);
    const wi = warmIv(on);
    expect(wi.length).toBeGreaterThan(0);
    expect(wi.length).toBeLessThanOrEqual(6);
    expect(on.warmVerdicts).toEqual([]);                    // a no-answer never writes a verdict
    if (wi.length === 6) expect(on.warmupSwitch).toBe("false"); // the 2nd pause = the stop turned the switch off
  }, 180_000);
});
