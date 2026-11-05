// A — TWO-WAY NO-OVERLAP under REALISTIC timing. The real worker (background.js + the frozen
// module) runs on a virtual clock (parcelCheckerHarness sim mode): every timer, tab reply and
// database call takes real time — E-Map 0.8 s / 3 s / 8 s, myship 1.5 s, database 150 ms, local
// messages 5 ms — for 30 virtual minutes with 100 dry parcels and 3 frozen parcels queued.
// Every E-Map request is an interval; we count, both ways:
//   frozenDuringNormal — a frozen request started while a normal row check / keepalive was open
//   normalDuringFrozen — a normal row check / keepalive started while a frozen request was open
// and compare the normal lane with MAIN's worker run on the same clock: same E-Map requests at
// the same times, same verdicts at the same times (= normal throughput unchanged).
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootWorker, makeSim, runSim, simOverlaps, SIM_FROZEN_ABORT_MS, type Sim } from "./parcelCheckerHarness";

const T0 = Date.UTC(2026, 0, 15, 2, 0, 0); // 10:00 Taipei (outside the maintenance window)
const MIN = 60_000;
type Opts = NonNullable<Parameters<typeof bootWorker>[0]>;
const LEADER: Opts["lease"] = (b) => ({ json: { leader: true, reason: "leader", leader_id: b.p_worker_id, leader_label: "sim", leader_age_s: 0, standby_ready: false, standby_age_s: null, ttl_s: 120 } });
const FROZEN = [{ id: "fz-1", store_id: "968551" }, { id: "fz-2", store_id: "133712" }, { id: "fz-3", store_id: "151003" }];

let mainDir = "";
beforeAll(() => {
  mainDir = join(tmpdir(), `sfl-main-ext-sim-${process.pid}`);
  mkdirSync(mainDir, { recursive: true });
  let ref = "origin/main";
  try { execSync("git rev-parse --verify --quiet origin/main", { stdio: "pipe" }); } catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); ref = "FETCH_HEAD"; }
  writeFileSync(join(mainDir, "background.js"), execSync(`git show ${ref}:chrome-extension/background.js`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
});

async function simRun(emapMs: number, opts: { main?: boolean; alarmMs?: number; minutes?: number } = {}): Promise<Sim> {
  const sim = makeSim({ t0: T0, emapMs, dry: 100, frozen: FROZEN });
  const w = bootWorker({ sim, lease: LEADER, ...(opts.main ? { extDir: mainDir } : {}) });
  await w.booted;
  await runSim(sim, T0 + (opts.minutes ?? 30) * MIN, opts.alarmMs ?? 0);
  return sim;
}
const normalLane = (s: Sim) => s.intervals.filter((i) => i.kind !== "frozen").map((i) => `${i.kind}:${i.rowId ?? ""}@${i.start}`);
const summary = (s: Sim) => {
  const o = simOverlaps(s.intervals);
  const fz = s.intervals.filter((i) => i.kind === "frozen");
  return {
    ...o, frozenRequests: fz.length,
    frozenAnswered: s.frozenVerdicts.filter((v) => v.status !== "unknown").length,
    frozenUnknown: s.frozenVerdicts.filter((v) => v.status === "unknown").length,
    firstFrozenAnswerS: s.frozenVerdicts.length ? Math.round((s.frozenVerdicts[0].t - T0) / 1000) : null,
    allFrozenAnsweredS: s.frozen.length === 0 && s.frozenVerdicts.length ? Math.round((s.frozenVerdicts[s.frozenVerdicts.length - 1].t - T0) / 1000) : null,
    normalVerdicts: s.normalVerdicts.length, keepalives: s.intervals.filter((i) => i.kind === "keepalive").length,
  };
};

describe("A · realistic timing: no overlap in either direction, normal throughput = main", () => {
  for (const emapMs of [800, 3000, 8000]) {
    it(`E-Map ${emapMs} ms — 30 min, 100 dry + 3 frozen: 0 overlaps both ways; the normal lane is request-for-request main's`, async () => {
      const ours = await simRun(emapMs);
      const main = await simRun(emapMs, { main: true });
      const s = summary(ours);
      if (process.env.SFL_SIM_REPORT) appendFileSync(process.env.SFL_SIM_REPORT, `[SIM] emap=${emapMs}ms ours=${JSON.stringify(s)} main.normalVerdicts=${main.normalVerdicts.length} main.normalNormal=${simOverlaps(main.intervals).normalNormal}\n`);
      expect(s.frozenDuringNormal).toBe(0);
      expect(s.normalDuringFrozen).toBe(0);
      expect(normalLane(ours)).toEqual(normalLane(main));                 // every normal request, at the same time
      expect(ours.normalVerdicts).toEqual(main.normalVerdicts);           // every verdict, at the same time
      expect(s.frozenRequests).toBeGreaterThan(0);
      if (emapMs <= SIM_FROZEN_ABORT_MS) {
        expect(s.frozenAnswered).toBe(3);                                   // all three frozen parcels answered…
        expect(s.allFrozenAnsweredS).not.toBeNull();
        expect(s.allFrozenAnsweredS!).toBeLessThanOrEqual(180);             // …within 3 minutes, behind 100 dry parcels
      } else {
        expect(s.frozenAnswered).toBe(0);                                   // E-Map slower than 2.5 s → the frozen check gives up ('unknown', retried after 10 min)
        expect(s.frozenUnknown).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});

describe("A · with Chrome's 30 s keepalive alarm (it can start a second pass while one is running — main's own behaviour, see normalNormal)", () => {
  for (const emapMs of [800, 3000, 8000]) {
    it(`E-Map ${emapMs} ms — still 0 overlaps both ways (the frozen lane waits for a moment with no second pass); the normal lane is main's`, async () => {
      const ours = await simRun(emapMs, { alarmMs: 30_000 });
      const main = await simRun(emapMs, { main: true, alarmMs: 30_000 });
      const s = summary(ours);
      if (process.env.SFL_SIM_REPORT) appendFileSync(process.env.SFL_SIM_REPORT, `[SIM+ALARM] emap=${emapMs}ms ours=${JSON.stringify(s)} main.normalVerdicts=${main.normalVerdicts.length} main.normalNormal=${simOverlaps(main.intervals).normalNormal}\n`);
      expect(s.frozenDuringNormal).toBe(0);
      expect(s.normalDuringFrozen).toBe(0);
      expect(normalLane(ours)).toEqual(normalLane(main));
      expect(ours.normalVerdicts).toEqual(main.normalVerdicts);
      expect(s.normalNormal).toBe(simOverlaps(main.intervals).normalNormal);   // main's own overlaps, unchanged
      expect(s.frozenRequests).toBeGreaterThan(0);
      if (emapMs <= SIM_FROZEN_ABORT_MS) expect(s.frozenAnswered).toBe(3);  // all answered within the 30 minutes
    }, 120_000);
  }
});
