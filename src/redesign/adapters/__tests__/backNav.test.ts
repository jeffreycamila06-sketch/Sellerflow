// Back button rule (Jeff 2026-11-11): Back goes to where the screen was opened from; a bottom-nav tab
// starts fresh; the Parcel Scan ⇄ never adds a step; no long history. Every "opens from" route in
// docs/plans/back-button-inventory.md is walked here through the pure record (adapters/backNav.ts).
import { describe, it, expect } from "vitest";
import { navigateOrigins, backFrom, tabOrigins, showsBack, HOME_SCREENS, DEFAULT_BACK, type NavOrigins } from "../backNav";

/** Walk a path of opens from a start screen, return the screen + record. */
function walk(start: string, ...opens: string[]): { screen: string; o: NavOrigins } {
  let o: NavOrigins = tabOrigins();
  let screen = start;
  for (const to of opens) { o = navigateOrigins(o, screen, to); screen = to; }
  return { screen, o };
}
const back = (s: { screen: string; o: NavOrigins }, fallback?: string) => { const r = backFrom(s.o, s.screen, fallback); return { screen: r.to, o: r.origins }; };

describe("every route in the inventory: Back returns to where the screen was opened from", () => {
  const routes: [string, string[], string][] = [
    // [start tab, opens…, expected Back target of the last screen]
    ["menu", ["settings"], "menu"],
    ["menu", ["customers"], "menu"],
    ["menu", ["settings", "subscription"], "settings"],
    ["menu", ["shipping", "subscription"], "shipping"],
    ["dashboard", ["subscription"], "dashboard"],          // free-limit popup on Live → screen under the popup
    ["orders", ["subscription"], "orders"],                // popup over Orders
    ["menu", ["settings", "support"], "settings"],
    ["menu", ["admin"], "menu"],                           // Admin from the Settings tile
    ["menu", ["shipping"], "menu"],
    ["orders", ["shipping"], "orders"],                    // Orders 🚚
    ["menu", ["customerdata"], "menu"],
    ["menu", ["legal"], "menu"],
    ["menu", ["settings", "support", "legal"], "support"],
    ["menu", ["customerdata", "legal"], "customerdata"],
    ["landing", ["legal"], "landing"],                     // signed out
    ["login", ["signup", "legal"], "signup"],              // signed out (app)
    ["login", ["signup"], "login"],
    ["menu", ["delete"], "menu"],                          // was: always General Settings
    ["menu", ["settings", "delete"], "settings"],
    ["menu", ["settings", "printersettings"], "settings"],
    ["menu", ["settings", "printpattern", "printersettings"], "printpattern"], // Live print pattern "Change"
    ["dashboard", ["settings", "printersettings"], "settings"],                 // no-printer popup → General Settings → picker
    ["menu", ["settings", "printpattern"], "settings"],
    ["menu", ["settings", "ttchannels"], "settings"],
    ["menu", ["settings", "fbchannels"], "settings"],
    ["dashboard", ["ttchannels"], "dashboard"],            // Live dropdown "Manage / add accounts"
    ["menu", ["settings", "ttchannels", "shopeechannels"], "ttchannels"], // was: skipped Manage accounts
    ["menu", ["settings", "fbchannels", "fbpages"], "fbchannels"],
    ["menu", ["settings", "ttchannels", "igaccounts"], "ttchannels"],
    ["dashboard", ["shopeechannels"], "dashboard"],
    ["dashboard", ["fbpages"], "dashboard"],
    ["dashboard", ["igaccounts"], "dashboard"],
    ["menu", ["parcelscan"], "menu"],
    ["menu", ["fmparcelscan"], "menu"],
    ["menu", ["customerdetails"], "menu"],
    ["menu", ["parceltracking"], "menu"],
    ["menu", ["receiptformat"], "menu"],
    ["orders", ["print"], "orders"],
  ];
  for (const [start, opens, want] of routes) {
    it(`${[start, ...opens].join(" → ")} · Back → ${want}`, () => {
      expect(back(walk(start, ...opens)).screen).toBe(want);
    });
  }
  it("Back twice walks back up the way it came (Shopee → Manage accounts → General Settings → Settings hub)", () => {
    let s = walk("menu", "settings", "ttchannels", "shopeechannels");
    s = back(s); expect(s.screen).toBe("ttchannels");
    s = back(s); expect(s.screen).toBe("settings");
    s = back(s); expect(s.screen).toBe("menu");
  });
});

describe("Parcel Scan ⇄ never adds a step", () => {
  it("7-11 → ⇄ FamilyMart → ⇄ 7-11 → ⇄ FamilyMart: Back → Settings hub (one step)", () => {
    const s = walk("menu", "parcelscan", "fmparcelscan", "parcelscan", "fmparcelscan");
    expect(back(s).screen).toBe("menu");
    expect(Object.keys(s.o)).toEqual(["fmparcelscan"]); // never more than one entry for the pair
  });
  it("opened from the FamilyMart tile, ⇄ 7-11 → Back → Settings hub", () => {
    expect(back(walk("menu", "fmparcelscan", "parcelscan")).screen).toBe("menu");
  });
});

describe("a bottom-nav tab is a fresh start", () => {
  it("any home screen clears the record", () => {
    for (const home of HOME_SCREENS) expect(navigateOrigins({ settings: "menu", delete: "settings" }, "delete", home)).toEqual({});
    expect(tabOrigins()).toEqual({});
  });
  it("General Settings opened from a popup on Live, then the Settings tab → General Settings again: Back → Settings hub (not Live)", () => {
    let s = walk("dashboard", "settings");
    expect(s.o.settings).toBe("dashboard");
    s = { screen: "menu", o: tabOrigins() };
    s = { screen: "settings", o: navigateOrigins(s.o, "menu", "settings") };
    expect(back(s).screen).toBe("menu");
  });
  it("Back onto a home screen leaves nothing behind", () => {
    expect(back(walk("menu", "settings")).o).toEqual({});
  });
});

describe("the record stays small (no long history)", () => {
  it("one entry per screen, even after many trips", () => {
    let s = back(back(walk("menu", "settings", "support", "legal")));
    for (let i = 0; i < 50; i++) {
      for (const to of ["support", "legal"]) s = { screen: to, o: navigateOrigins(s.o, s.screen, to) };
      s = back(back(s));
    }
    expect(Object.keys(s.o).length).toBeLessThanOrEqual(1);
  });
  it("no loop: opening the screen you came from keeps its own origin", () => {
    const o = navigateOrigins({ settings: "menu", support: "settings" }, "support", "settings");
    expect(o.settings).toBe("menu");
  });
  it("same screen → nothing changes", () => {
    const o = { settings: "menu" };
    expect(navigateOrigins(o, "settings", "settings")).toBe(o);
  });
});

describe("who shows a Back", () => {
  it("never on the 5 home tabs, Login or Landing", () => {
    for (const s of ["dashboard", "salestab", "orders", "products", "menu", "login", "landing"]) expect(showsBack({ [s]: "menu" }, s), s).toBe(false);
  });
  it("Admin: only when opened from the Settings tile (not its own nav button)", () => {
    expect(showsBack(walk("menu", "admin").o, "admin")).toBe(true);
    expect(showsBack(tabOrigins(), "admin")).toBe(false);
  });
  it("every sub-screen does, with a fallback target if nothing was recorded", () => {
    for (const s of Object.keys(DEFAULT_BACK).filter((k) => k !== "admin")) {
      expect(showsBack({}, s), s).toBe(true);
      expect(backFrom({}, s).to, s).toBe(DEFAULT_BACK[s]);
    }
    expect(backFrom({}, "legal", "landing").to).toBe("landing"); // signed out: the caller passes Landing / Login
  });
});
