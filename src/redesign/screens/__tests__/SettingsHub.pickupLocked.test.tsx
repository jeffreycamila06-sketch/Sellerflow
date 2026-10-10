// Pickup Status 🔒 upsell tile for basic/free TW sellers without access — built like the
// locked Parcel Scan / Customer Details tiles; a tap opens the contact-support popup
// (onParcelUpsell), never the screen. Rule = parcelTrackingLocked (same basic/free rule).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import SettingsHub from "../SettingsHub";
import { parcelTrackingLocked, parcelTrackingVisible } from "../../adapters/parcelTracking";
import { parcelScanVisible } from "../../adapters/parcelScan";

const noop = () => {};
const base = { onGeneral: noop, onCustomers: noop, onAdmin: noop, onCustomerData: noop, onLegal: noop, onDelete: noop, onLogout: noop };

// The same wiring RedesignApp uses, from a profile + market + own access flag.
function hubFor(p: { role?: string; plan?: string | null; access?: boolean; nonTw?: boolean }) {
  const allowed = parcelTrackingVisible({ role: p.role, plan: p.plan, access: !!p.access, marketHidden: !!p.nonTw });
  const locked = parcelTrackingLocked({ role: p.role, plan: p.plan, allowed, marketHidden: !!p.nonTw });
  const onParcelTracking = vi.fn(), onParcelUpsell = vi.fn();
  const r = render(<TProvider lang="en"><SettingsHub {...base} onParcelTracking={allowed ? onParcelTracking : undefined} pickupLocked={locked} onParcelUpsell={onParcelUpsell} /></TProvider>);
  return { r, onParcelTracking, onParcelUpsell };
}

describe("Pickup Status tile — who sees what", () => {
  it("basic, TW, no access → locked tile (🔒); tap = upsell popup, never the screen", () => {
    const { r, onParcelTracking, onParcelUpsell } = hubFor({ role: "seller", plan: "basic" });
    const tile = r.getByTestId("tile-parceltracking-locked");
    expect(tile.getAttribute("data-locked")).toBe("1");
    expect(tile.textContent).toContain("🔒");
    expect(r.queryByTestId("tile-parceltracking")).toBeNull();
    fireEvent.click(tile);
    expect(onParcelUpsell).toHaveBeenCalledTimes(1);
    expect(onParcelTracking).not.toHaveBeenCalled();
  });
  for (const plan of ["free", "", null, " FREE "]) {
    it(`plan ${JSON.stringify(plan)} → locked tile`, () => {
      expect(hubFor({ role: "seller", plan }).r.getByTestId("tile-parceltracking-locked")).toBeTruthy();
    });
  }
  it("basic with an expired plan → still the locked tile (expiry does not matter)", () => {
    expect(parcelTrackingLocked({ role: "seller", plan: "Basic", allowed: false })).toBe(true);
  });
  for (const plan of ["plus", "pro", "master"]) {
    it(`${plan} without access → neither tile`, () => {
      const { r } = hubFor({ role: "seller", plan });
      expect(r.queryByTestId("tile-parceltracking")).toBeNull();
      expect(r.queryByTestId("tile-parceltracking-locked")).toBeNull();
    });
  }
  it("non-TW → neither tile (basic or paid)", () => {
    for (const plan of ["basic", "pro"]) {
      const { r } = hubFor({ role: "seller", plan, nonTw: true, access: true });
      expect(r.queryByTestId("tile-parceltracking")).toBeNull();
      expect(r.queryByTestId("tile-parceltracking-locked")).toBeNull();
      r.unmount();
    }
  });
  it("with access → the working tile only", () => {
    const { r, onParcelTracking, onParcelUpsell } = hubFor({ role: "seller", plan: "plus", access: true });
    fireEvent.click(r.getByTestId("tile-parceltracking"));
    expect(onParcelTracking).toHaveBeenCalledTimes(1);
    expect(onParcelUpsell).not.toHaveBeenCalled();
    expect(r.queryByTestId("tile-parceltracking-locked")).toBeNull();
  });
  it("admin (even on a basic/blank plan) → the working tile only", () => {
    for (const plan of ["master", "basic", ""]) {
      const { r } = hubFor({ role: "admin", plan });
      expect(r.getByTestId("tile-parceltracking")).toBeTruthy();
      expect(r.queryByTestId("tile-parceltracking-locked")).toBeNull();
      r.unmount();
    }
  });
  it("same basic/free rule as the Parcel Scan locked tile", () => {
    for (const plan of ["basic", "free", "", null, "plus", "pro", "master", "Basic "]) {
      const scan = parcelScanVisible({ role: "seller", plan, planStatus: "active", planExpiry: null, manualEnabled: false }).locked;
      expect(parcelTrackingLocked({ role: "seller", plan, allowed: false })).toBe(scan);
    }
  });
});
