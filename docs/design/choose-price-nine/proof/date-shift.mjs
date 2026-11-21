// Moves "now" for one process: Date.now() and new Date() = SFL_FAKE_NOW + the real time passed since start.
// PGlite's now() follows it too. Used to prove a test does not depend on the day it runs (2026-11-22).
//   scripts:  SFL_FAKE_NOW=2027-01-01T00:30:00+08:00 PGLITE_DIR=<pglite> node --import ./docs/design/choose-price-nine/proof/date-shift.mjs scripts/sql195-behaviour.mjs
//   vitest:   copy this file to src/__shift__/shift-setup.ts and run with a local config that adds it to test.setupFiles
//             (mergeConfig(base, { test: { setupFiles: ["./src/__shift__/shift-setup.ts"] } })), then delete both.
const target = Date.parse(process.env.SFL_FAKE_NOW || "");
if (Number.isFinite(target)) {
  const Real = globalThis.Date, offset = target - Real.now();
  class Shifted extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + offset); else super(...a); }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = Shifted;
}
