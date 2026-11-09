// Item 6 (Jeff 2026-11-09): the screen's notes + "+" limits never freeze the phone — the layouts are steps
// (one step = one layout pass), run in idle slices of ≤ SLICE_MS (+ at most one pass), and kept per setting.
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { recommendedSettings, screenFitNotes, screenFitNotesSteps, screenStepCaps, type OneStickerSettings } from "../oneSticker";
import { runInSlices, startScreenFit, cachedFit, rememberFit, __clearScreenFitCache, SLICE_MS, type RunStats } from "../oneStickerScreen";
import { sampleInput, renderOptsFor } from "../oneStickerPrint";
import type { Fonts } from "../oneStickerText";
import { fullFonts, installNodeFallbackDrawer } from "./oneSticker.harness";

let F: Fonts;
beforeAll(async () => { installNodeFallbackDrawer(); F = await fullFonts(); });
/** a scheduler the test drives: nothing runs until `flush` */
const manual = () => {
  const q: (() => void)[] = [];
  return { schedule: (cb: () => void) => { q.push(cb); return () => { const i = q.indexOf(cb); if (i >= 0) q.splice(i, 1); }; }, flush: () => { let n = 0; while (q.length) { q.shift()!(); n++; } return n; }, size: () => q.length };
};
const heavy = (): OneStickerSettings => { const s = recommendedSettings({ w: 60, h: 40 }); s.parts.buyer.scale = 2; s.parts.name.scale = 1.5; return s; };

describe("idle slices", () => {
  it("nothing is worked out on the tap itself: the first slice runs only when the phone is idle", () => {
    const m = manual();
    let done = false;
    runInSlices(screenFitNotesSteps(heavy(), sampleInput("My Shop"), F, {}), () => { done = true; }, m.schedule);
    expect(done).toBe(false);
    expect(m.size()).toBe(1);
    m.flush();
    expect(done).toBe(true);
  });
  it("a slice of 0 ms = ONE layout pass per slice: the heavy work is split into many short pieces, same answer as all at once", () => {
    const m = manual();
    let got: unknown = null, stats: RunStats | null = null;
    runInSlices(screenFitNotesSteps(heavy(), sampleInput("My Shop"), F, {}), (v, st) => { got = v; stats = st; }, m.schedule, 0);
    m.flush();
    expect(stats!.slices).toBeGreaterThan(10);
    expect(got).toEqual(screenFitNotes(heavy(), sampleInput("My Shop"), F, {}));
  });
  it("cancel stops it (a newer tap): no answer arrives", () => {
    const m = manual();
    let done = false;
    const cancel = runInSlices(screenFitNotesSteps(heavy(), sampleInput("My Shop"), F, {}), () => { done = true; }, m.schedule, 0);
    cancel();
    m.flush();
    expect(done).toBe(false);
  });
  it("notes first, then the \"+\" limits; both equal the all-at-once answers; the longest slice stays short", () => {
    const m = manual();
    const order: string[] = [];
    let fit: { notes: unknown; caps: unknown } | null = null;
    let st: { notes: RunStats; caps: RunStats } | null = null;
    const s = heavy();
    startScreenFit(s, sampleInput("My Shop"), F, renderOptsFor("d520", s), () => order.push("notes"), (f, stats) => { order.push("caps"); fit = f; st = stats; }, m.schedule);
    m.flush();
    expect(order).toEqual(["notes", "caps"]);
    expect(fit!.notes).toEqual(screenFitNotes(s, sampleInput("My Shop"), F, renderOptsFor("d520", s)));
    expect(fit!.caps).toEqual(screenStepCaps(s, sampleInput("My Shop"), F, renderOptsFor("d520", s)));
    // a slice ends once SLICE_MS is used up (one pass may overrun it): far from a frozen screen
    expect(st!.notes.longestSliceMs).toBeLessThan(SLICE_MS + 80);
    expect(st!.caps.longestSliceMs).toBeLessThan(SLICE_MS + 80);
    if (process.env.TIMING_OUT) appendFileSync(process.env.TIMING_OUT, `60x40 Buyer 2x name 1.5x: notes ${st!.notes.totalMs.toFixed(0)} ms in ${st!.notes.slices} slices (longest ${st!.notes.longestSliceMs.toFixed(1)}), limits ${st!.caps.totalMs.toFixed(0)} ms in ${st!.caps.slices} slices (longest ${st!.caps.longestSliceMs.toFixed(1)})\n`);
  }, 120000);
  it("a setting worked out once is kept: going back is instant", () => {
    __clearScreenFitCache();
    expect(cachedFit("k")).toBeUndefined();
    rememberFit("k", { notes: [{ kind: "ok" }], caps: {} });
    expect(cachedFit("k")).toEqual({ notes: [{ kind: "ok" }], caps: {} });
    for (let i = 0; i < 60; i++) rememberFit(`x${i}`, { notes: [], caps: {} });
    expect(cachedFit("k")).toBeUndefined(); // only the last 40
  });
});
