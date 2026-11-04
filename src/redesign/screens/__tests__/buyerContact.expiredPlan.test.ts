// Buyer contact inherits the expired-plan lock: the picker and the Pickup Status contact
// buttons only exist INSIDE Parcel Scan / Customer Details / Pickup Status, and RedesignApp
// renders those screens only behind parcelAllowed / parcelTrackingAllowed. For an expired
// Plus seller both gates are false — even with the buyer-contact switch on and a preview
// key — so no contact button can ever reach the screen.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parcelTrackingVisible } from "../../adapters/parcelTracking";
import { parcelScanVisible } from "../../adapters/parcelScan";
import { buyerContactVisible } from "../../adapters/buyerContact";

const NOW = new Date("2026-11-04T06:00:00Z").getTime();
const expiredPlus = { role: "seller", plan: "plus", planStatus: "expired", planExpiry: "2026-10-01T00:00:00Z" };

describe("expired Plus seller → no contact buttons anywhere", () => {
  it("buyer contact itself would be on (switch + tier), but both screens that host it are gated off", () => {
    expect(buyerContactVisible({ role: "seller", plan: "plus", switchOn: true, previewKey: true })).toBe(true);
    expect(parcelTrackingVisible({ ...expiredPlus, nowMs: NOW, access: true })).toBe(false);
    expect(parcelScanVisible({ ...expiredPlus, manualEnabled: true, nowMs: NOW }).visible).toBe(false);
  });
  it("RedesignApp renders Parcel Scan / Customer Details / Pickup Status (the only hosts of contactOn) only behind those gates", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toMatch(/screen === "parcelscan" && parcelAllowed && \(/);
    expect(src).toMatch(/screen === "customerdetails" && parcelAllowed && <CustomerDetails [^\n]*contactOn=\{buyerContactOn\}/);
    expect(src).toMatch(/screen === "parceltracking" && parcelTrackingAllowed && <ParcelTracking [^\n]*contactOn=\{buyerContactOn\}/);
    // contactOn is passed to no other screen
    const hosts = src.match(/contactOn=\{buyerContactOn\}/g) || [];
    const fm = src.match(/screen === "fmparcelscan" && fmScanAllowed && <FmParcelScan [^\n]*contactOn=\{buyerContactOn\}/g) || [];
    expect(hosts.length).toBe(3 + fm.length);
  });
  it("renewed → the gates open again", () => {
    const renewed = { ...expiredPlus, planStatus: "active", planExpiry: "2027-01-01T00:00:00Z" };
    expect(parcelTrackingVisible({ ...renewed, nowMs: NOW, access: true })).toBe(true);
    expect(parcelScanVisible({ ...renewed, manualEnabled: true, nowMs: NOW }).visible).toBe(true);
  });
});
