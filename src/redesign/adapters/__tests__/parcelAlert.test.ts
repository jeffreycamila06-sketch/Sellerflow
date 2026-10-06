// PARCEL CHECK attention alert — behavioral. newlyFlagged fires ONLY on a real
// transition into a problem verdict (so re-polls don't re-chime); attentionCount
// counts current problem rows; null/'unknown' never count.
import { describe, it, expect } from "vitest";
import { newlyFlagged, attentionCount } from "../parcelAlert";

describe("newlyFlagged — chime only on a genuine NEW problem verdict", () => {
  it("null → restricted / null → full both fire", () => {
    const prev = [{ id: "a" }, { id: "b" }];
    const fresh = [{ id: "a", phoneCheckStatus: "restricted" }, { id: "b", storeFullStatus: "full" }];
    expect(newlyFlagged(prev, fresh)).toEqual({ restricted: 1, full: 1 });
  });
  it("already-flagged row does NOT re-fire (a re-poll is silent)", () => {
    const prev = [{ id: "a", phoneCheckStatus: "restricted" }];
    expect(newlyFlagged(prev, prev)).toEqual({ restricted: 0, full: 0 });
  });
  it("ok / unknown / null transitions never fire", () => {
    const prev = [{ id: "a" }, { id: "b", phoneCheckStatus: "restricted" }];
    const fresh = [{ id: "a", phoneCheckStatus: "ok", storeFullStatus: "open" }, { id: "b", phoneCheckStatus: "unknown" }];
    expect(newlyFlagged(prev, fresh)).toEqual({ restricted: 0, full: 0 });
  });
  it("restricted takes priority over full on the same new row (more urgent)", () => {
    const nf = newlyFlagged([{ id: "a" }], [{ id: "a", phoneCheckStatus: "restricted", storeFullStatus: "full" }]);
    expect(nf).toEqual({ restricted: 1, full: 0 });
  });
});

describe("attentionCount — current problem rows", () => {
  it("counts restricted + full, ignores ok/unknown/null", () => {
    expect(attentionCount([
      { id: "1", phoneCheckStatus: "restricted" },
      { id: "2", storeFullStatus: "full" },
      { id: "3", phoneCheckStatus: "ok", storeFullStatus: "open" },
      { id: "4", phoneCheckStatus: "unknown" },
      { id: "5" },
    ])).toBe(2);
  });
});

describe("fix 8 — frozen_unavailable counts like 'full' (chime, banner)", () => {
  it("null → frozen_unavailable fires the store chime; already flagged does not re-fire; full ↔ frozen_unavailable is not new", () => {
    expect(newlyFlagged([{ id: "a" }], [{ id: "a", storeFullStatus: "frozen_unavailable" }])).toEqual({ restricted: 0, full: 1 });
    expect(newlyFlagged([{ id: "a", storeFullStatus: "frozen_unavailable" }], [{ id: "a", storeFullStatus: "frozen_unavailable" }])).toEqual({ restricted: 0, full: 0 });
    expect(newlyFlagged([{ id: "a", storeFullStatus: "full" }], [{ id: "a", storeFullStatus: "frozen_unavailable" }])).toEqual({ restricted: 0, full: 0 });
  });
  it("attentionCount includes frozen_unavailable", () => {
    expect(attentionCount([{ id: "a", storeFullStatus: "frozen_unavailable" }, { id: "b", storeFullStatus: "full" }, { id: "c", storeFullStatus: "open" }])).toBe(2);
  });
});
