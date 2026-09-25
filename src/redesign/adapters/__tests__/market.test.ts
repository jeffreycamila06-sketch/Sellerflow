// Market resolver (PH/TW split) + the admin bypass / "view as" preview + the 3 gates'
// market-hide flag. Pins: NULL/TW = TW (unchanged); non-TW = PH (features off, ₱);
// admin sees the union UNLESS previewing a market; each gate hides only when told.
import { describe, it, expect } from "vitest";
import { marketFor, effectiveMarket, marketHides, MARKETS } from "../market";
import { parcelScanVisible, canUseStickerQr } from "../parcelScan";
import { parcelTrackingVisible } from "../parcelTracking";
import { curSymbol } from "../../data";

const future = "2027-01-01T00:00:00Z";

describe("marketFor", () => {
  it("NULL / blank / TW → the TW market (unchanged), all features on, TWD", () => {
    for (const c of [null, undefined, "", "TW", "tw", " Tw "]) {
      const m = marketFor(c);
      expect(m.country).toBe("TW");
      expect(m.currency).toBe("TWD");
      expect(m.features).toEqual({ parcelScan: true, pickupStatus: true, stickerQr: true, shopee: true });
      expect(m.shippingModule).toBe("tw-711");
    }
  });
  it("each KNOWN non-TW country → its OWN currency + TW-only features OFF", () => {
    const expected: Record<string, { currency: string; symbol: string; ship: string }> = {
      PH: { currency: "PHP", symbol: "₱", ship: "ph" },
      VN: { currency: "VND", symbol: "₫", ship: "none" },
      TH: { currency: "THB", symbol: "฿", ship: "none" },
      ID: { currency: "IDR", symbol: "Rp", ship: "none" },
      MY: { currency: "MYR", symbol: "RM", ship: "none" },
      BG: { currency: "EUR", symbol: "€", ship: "none" },
    };
    for (const [c, e] of Object.entries(expected)) {
      const m = marketFor(c);
      expect(m.currency).toBe(e.currency);
      expect(curSymbol(m.currency)).toBe(e.symbol);
      expect(m.features).toEqual({ parcelScan: false, pickupStatus: false, stickerQr: false, shopee: false });
      expect(m.shippingModule).toBe(e.ship);
    }
    expect(Object.keys(MARKETS).sort()).toEqual(["BG", "ID", "MY", "PH", "TH", "TW", "VN"]);
  });
  it("VN gets ₫ (VND), NOT ₱ (the old any-non-TW→PH bug)", () => {
    expect(curSymbol(marketFor("VN").currency)).toBe("₫");
    expect(marketFor("VN").currency).not.toBe("PHP");
  });
  it("unknown non-TW (e.g. SG, US) → features OFF, currency '' (keep default/pick), ship none", () => {
    for (const c of ["SG", "US", "ZZ"]) {
      const m = marketFor(c);
      expect(m.currency).toBe("");
      expect(m.features).toEqual({ parcelScan: false, pickupStatus: false, stickerQr: false, shopee: false });
      expect(m.shippingModule).toBe("none");
      expect(m.country).toBe(c);
    }
  });
});

describe("effectiveMarket — admin bypass + view-as", () => {
  it("non-admin → their profile market, no union (PH hides)", () => {
    expect(effectiveMarket({ role: "seller", country: "PH" })).toEqual({ market: marketFor("PH"), adminUnion: false });
    expect(effectiveMarket({ role: "seller", country: null }).market.country).toBe("TW");
  });
  it("admin + All → UNION (adminUnion true) regardless of country → nothing hides", () => {
    const eff = effectiveMarket({ role: "admin", country: "PH", viewAs: "all" });
    expect(eff.adminUnion).toBe(true);
    expect(marketHides("parcelScan", eff)).toBe(false); // admin sees TW features even as a PH-country admin
  });
  it("admin + view-as PH → previews AS a PH seller (union OFF, PH hides)", () => {
    const eff = effectiveMarket({ role: "admin", country: "TW", viewAs: "PH" });
    expect(eff.adminUnion).toBe(false);
    expect(marketHides("stickerQr", eff)).toBe(true);
  });
  it("admin + view-as TW → TW features visible", () => {
    expect(marketHides("pickupStatus", effectiveMarket({ role: "admin", country: "PH", viewAs: "TW" }))).toBe(false);
  });
  it("admin + view-as BG → previews AS a Bulgarian seller (EUR, TW features hidden)", () => {
    const eff = effectiveMarket({ role: "admin", country: "TW", viewAs: "BG" });
    expect(eff.adminUnion).toBe(false);
    expect(eff.market.currency).toBe("EUR");
    expect(marketHides("parcelScan", eff)).toBe(true);
  });
});

describe("gates honor marketHidden (admin bypass baked into the flag)", () => {
  it("parcelScanVisible: marketHidden → CLEAN hide (no locked tile); false → today's logic", () => {
    expect(parcelScanVisible({ role: "seller", plan: "pro", planStatus: "active", planExpiry: future, manualEnabled: true, marketHidden: true }))
      .toEqual({ visible: false, manualOnly: false, locked: false });
    // NULL/TW (marketHidden false) → today: a basic seller still gets the locked upsell tile.
    expect(parcelScanVisible({ role: "seller", plan: "basic", planStatus: "active", planExpiry: future, manualEnabled: true, marketHidden: false }).locked).toBe(true);
  });
  it("parcelTrackingVisible: marketHidden hides even an admin (view-as preview)", () => {
    expect(parcelTrackingVisible({ role: "admin", email: "x@y.com", plan: "master", marketHidden: true })).toBe(false);
    expect(parcelTrackingVisible({ role: "admin", email: "x@y.com", plan: "master", marketHidden: false })).toBe(true);
  });
  it("canUseStickerQr: marketHidden → false; in-market → true on every plan", () => {
    expect(canUseStickerQr(true)).toBe(false);
    expect(canUseStickerQr(false)).toBe(true);
  });
});
