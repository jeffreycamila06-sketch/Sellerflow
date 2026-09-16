// Phase 4 nav wiring — the Customer Details tile is gated by the onCustomerDetails
// prop (same as onParcelScan): present + clickable when passed, absent otherwise.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import SettingsHub from "../SettingsHub";

const t = buildT("en");
const noop = () => {};
const base = {
  onGeneral: noop, onCustomers: noop, onAdmin: noop, onSales: noop, onShipping: noop,
  onCustomerData: noop, onLegal: noop, onDelete: noop, onLogout: noop,
};
const view = (extra: Record<string, unknown> = {}) =>
  render(<TProvider><SettingsHub {...base} {...extra} /></TProvider>);

describe("SettingsHub — Customer Details tile", () => {
  it("hidden when onCustomerDetails is not passed", () => {
    const r = view();
    expect(r.queryByText(t.rd_cd_title)).toBeNull();
  });
  it("shown and clickable when passed (next to Parcel Scan)", () => {
    const onCustomerDetails = vi.fn();
    const onParcelScan = vi.fn();
    const r = view({ onCustomerDetails, onParcelScan });
    const tile = r.getByText(t.rd_cd_title);
    expect(tile).toBeTruthy();
    expect(r.getByText(t.rd_ps2_title)).toBeTruthy(); // Parcel Scan tile also present
    fireEvent.click(tile);
    expect(onCustomerDetails).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsHub — LOCKED upsell tiles (basic/free)", () => {
  it("parcelLocked → both tiles show as locked (🔒) and click the upsell, not the screen", () => {
    const onParcelUpsell = vi.fn();
    // No onParcelScan / onCustomerDetails (feature not allowed) + parcelLocked true.
    const r = view({ parcelLocked: true, onParcelUpsell });
    const ps = r.getByTestId("tile-parcelscan-locked");
    const cd = r.getByTestId("tile-customerdetails-locked");
    expect(ps.getAttribute("data-locked")).toBe("1");
    expect(cd.getAttribute("data-locked")).toBe("1");
    // no allowed (unlocked) tiles rendered
    expect(r.queryByTestId("tile-parcelscan")).toBeNull();
    expect(r.queryByTestId("tile-customerdetails")).toBeNull();
    fireEvent.click(ps);
    fireEvent.click(cd);
    expect(onParcelUpsell).toHaveBeenCalledTimes(2);
  });

  it("allowed (onParcelScan passed) wins over locked → normal tiles, no lock, no upsell", () => {
    const onParcelScan = vi.fn();
    const onCustomerDetails = vi.fn();
    const onParcelUpsell = vi.fn();
    const r = view({ onParcelScan, onCustomerDetails, parcelLocked: true, onParcelUpsell });
    expect(r.getByTestId("tile-parcelscan")).toBeTruthy();
    expect(r.getByTestId("tile-customerdetails")).toBeTruthy();
    expect(r.queryByTestId("tile-parcelscan-locked")).toBeNull();
    expect(r.queryByTestId("tile-customerdetails-locked")).toBeNull();
    fireEvent.click(r.getByTestId("tile-parcelscan"));
    expect(onParcelScan).toHaveBeenCalledTimes(1);
    expect(onParcelUpsell).not.toHaveBeenCalled();
  });

  it("not locked and not allowed → neither tile appears (existing hide behavior)", () => {
    const r = view({ parcelLocked: false });
    expect(r.queryByTestId("tile-parcelscan")).toBeNull();
    expect(r.queryByTestId("tile-parcelscan-locked")).toBeNull();
    expect(r.queryByTestId("tile-customerdetails")).toBeNull();
    expect(r.queryByTestId("tile-customerdetails-locked")).toBeNull();
  });
});
