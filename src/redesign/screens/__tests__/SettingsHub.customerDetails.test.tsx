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
