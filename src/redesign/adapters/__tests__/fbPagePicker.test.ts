// Facebook page picker with 2+ Pages. Bug: while Page A was connected, choosing Page B and
// tapping the chip stopped Page B (not running) — A kept polling and the pill latched gray
// for good. Now the Page that is REALLY connected (the server-reported scope key) drives the
// chip: Disconnect stops it, connecting a different Page first stops it, the pill follows it.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
import { fbLivePageOf, fbChipState, fbPageScopeKey, type FbPage } from "../fb";

const A: FbPage = { id: "r1", pageId: "PA", name: "Page A", username: "pagea", active: true };
const B: FbPage = { id: "r2", pageId: "PB", name: "Page B", username: "", active: true };
const pages = [A, B];

describe("fbLivePageOf — the Page that is really connected", () => {
  it("matches the server scope key (username, else page id), case/@-insensitive", () => {
    expect(fbLivePageOf(true, "pagea", pages)).toBe(A);
    expect(fbLivePageOf(true, "@PageA", pages)).toBe(A);
    expect(fbLivePageOf(true, "PB", pages)).toBe(B);
    expect(fbPageScopeKey(B)).toBe("PB");
  });
  it("not connected / no key / unknown key → null", () => {
    expect(fbLivePageOf(false, "pagea", pages)).toBeNull();
    expect(fbLivePageOf(true, "", pages)).toBeNull();
    expect(fbLivePageOf(true, "other", pages)).toBeNull();
  });
});

describe("fbChipState", () => {
  it("A connected, A selected → green; Disconnect stops A", () => {
    expect(fbChipState({ connected: true, livePage: A, selected: A })).toEqual({ chipConnected: true, action: { kind: "disconnect", pageId: "PA" } });
  });
  it("THE BUG: A connected, B selected → pill not green for B; the tap stops A first, then connects B", () => {
    expect(fbChipState({ connected: true, livePage: A, selected: B })).toEqual({ chipConnected: false, action: { kind: "switch", stopPageId: "PA", page: B } });
  });
  it("Disconnect never targets the selected Page when another one is live", () => {
    for (const selected of [A, B]) {
      const { action } = fbChipState({ connected: true, livePage: A, selected });
      if (action.kind === "disconnect") expect(action.pageId).toBe("PA");
      if (action.kind === "switch") expect(action.stopPageId).toBe("PA");
    }
  });
  it("nothing connected → connect the selected Page", () => {
    expect(fbChipState({ connected: false, livePage: null, selected: B })).toEqual({ chipConnected: false, action: { kind: "connect", page: B } });
  });
  it("one Page (or an unattributable connection) → today's behaviour: green, Disconnect the selected Page", () => {
    expect(fbChipState({ connected: true, livePage: null, selected: A })).toEqual({ chipConnected: true, action: { kind: "disconnect", pageId: "PA" } });
    expect(fbChipState({ connected: false, livePage: null, selected: A })).toEqual({ chipConnected: false, action: { kind: "connect", page: A } });
  });
  it("no page selected → nothing to do", () => {
    expect(fbChipState({ connected: false, livePage: null, selected: null })).toEqual({ chipConnected: false, action: { kind: "none" } });
    expect(fbChipState({ connected: true, livePage: null, selected: null })).toEqual({ chipConnected: true, action: { kind: "none" } });
  });
});
