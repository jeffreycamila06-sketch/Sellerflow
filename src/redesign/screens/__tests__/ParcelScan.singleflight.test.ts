// FIX 1 — single-flight guard on the scan pipeline (the money path). A
// double-tap of "Use" (or a rapid re-pick) fired in the SAME tick must charge
// only ONE scan. This can't be reproduced through the DOM in a unit render:
// React's own input value-tracker de-dupes two identical `change` events (so a
// double-dispatch masks the bug regardless of the guard), and scanOne flips
// phase→"scanning" synchronously, unmounting the trigger before a second real
// event can land. So — exactly like RedesignApp.submitEnt's entSubmittedRef
// (Dashboard.entSubmit.test.tsx) — this pins the SOURCE CONTRACT: a synchronous
// ref checked AND set at the top of beginScan BEFORE scanOne, released in a
// scanOne finally so no path leaves a permanent lock. Red without the guard,
// green with it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../ParcelScan.tsx"), "utf8");

describe("ParcelScan scan single-flight guard (money-path)", () => {
  it("declares a synchronous in-flight ref", () => {
    expect(src).toMatch(/const scanInFlightRef = useRef\(false\);/);
  });

  it("beginScan checks AND sets the ref synchronously BEFORE scanOne", () => {
    const begin = src.indexOf("const beginScan =");
    expect(begin).toBeGreaterThan(-1);
    const guardIdx = src.indexOf("if (scanInFlightRef.current) return;", begin);
    const setIdx = src.indexOf("scanInFlightRef.current = true;", begin);
    const scanIdx = src.indexOf("void scanOne(", begin);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(guardIdx);   // guard first
    expect(setIdx).toBeLessThan(scanIdx);       // marked BEFORE the (charged) scan — same-tick re-entry blocked
  });

  it("scanOne releases the ref in a finally (confirm/error/insufficient/credits=0/throw — no permanent lock)", () => {
    const scanOne = src.indexOf("const scanOne = async");
    expect(scanOne).toBeGreaterThan(-1);
    const finallyIdx = src.indexOf("} finally {", scanOne);
    const clearIdx = src.indexOf("scanInFlightRef.current = false;", scanOne);
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(finallyIdx); // cleared inside the finally
  });
});
