// WAYBILL USERNAME — who sees it: every market × switch × preview key × admin (+ the admin's "View as").
import { describe, expect, it } from "vitest";
import { waybillAccess, shippingCountry } from "../waybillGate";
import { effectiveMarket, type ViewAs } from "../market";

const access = (role: string, country: string | null, switchOn: boolean, hasKey: boolean, viewAs?: ViewAs) =>
  waybillAccess({ market: effectiveMarket({ role, country, viewAs }), isAdmin: role === "admin", switchOn, hasKey });

describe("sellers (not admin): market × switch × key", () => {
  const cases: [string | null, boolean, boolean, string][] = [];
  for (const country of ["PH", "TW", null, "VN", "TH", "ID", "MY", "BG", "US"]) {
    for (const sw of [false, true]) for (const key of [false, true]) {
      const open = sw || key;
      const want = !open ? "hidden" : country === "PH" ? "full" : country === "TW" || country === null ? "soon" : "hidden";
      cases.push([country, sw, key, want]);
    }
  }
  it.each(cases)("country %s · switch %s · key %s → %s", (country, sw, key, want) => {
    expect(access("seller", country, sw, key)).toBe(want);
  });
  it("lower-case country codes work the same", () => {
    expect(access("seller", "ph", true, false)).toBe("full");
    expect(access("seller", "tw", true, false)).toBe("soon");
  });
});

describe("admins", () => {
  it("all markets (the admin's normal view) → the full screen, switch or not", () => {
    for (const country of ["TW", "PH", null, "VN"]) for (const sw of [false, true]) expect(access("admin", country, sw, false)).toBe("full");
  });
  it("'View as' keeps working: Philippines → full, Taiwan → soon, another market → hidden (switch off too)", () => {
    expect(access("admin", "TW", false, false, "PH")).toBe("full");
    expect(access("admin", "PH", false, false, "TW")).toBe("soon");
    expect(access("admin", "TW", false, false, "VN")).toBe("hidden");
    expect(access("admin", "TW", true, false, "MY")).toBe("hidden");
  });
});

describe("the country under the Shipping title", () => {
  it("full → Philippines, soon → Taiwan, hidden → none", () => {
    expect(shippingCountry("full")).toBe("ph");
    expect(shippingCountry("soon")).toBe("tw");
    expect(shippingCountry("hidden")).toBeNull();
  });
});
