// Step 3 — Auto Mode card: the old visual-only "Trigger word sets" chips are gone;
// the expanded card now shows real CODE→PRODUCT→INVENTORY rows sourced from the
// catalog (productsDb falls back to the local seed in the unconfigured test env).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";
import { PRODUCT_DEFAULTS } from "../../adapters/products";

const auto: AutoControls = { detect: true, setupOpen: true, toggle: () => {}, toggleSetup: () => {} }; // F-batch: trimmed shape
const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};
const renderGS = () => render(
  <TProvider lang="en">
    <GeneralSettings
      theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop}
      printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
    />
  </TProvider>,
);

describe("Auto Mode card (Step 3)", () => {
  beforeEach(() => localStorage.clear());

  it("removed the old trigger-word UI", () => {
    renderGS();
    expect(screen.queryByText("Trigger word sets")).toBeNull();
    expect(screen.queryByText(/word = price/)).toBeNull();
  });

  it("shows the real code→product setup once the catalog loads", async () => {
    renderGS();
    expect(screen.getByText("Code → product")).toBeTruthy();
    // catalog resolves async (local seed in the test env) → Add code becomes available
    await waitFor(() => expect(screen.getByText("+ Add code")).toBeTruthy());
  });

  it("adding a code renders a row with the product picker + Active status", async () => {
    renderGS();
    const add = await screen.findByText("+ Add code");
    fireEvent.click(add);
    // product picker lists the catalog (first seed product) and the row is Active (stock>0)
    await waitFor(() => expect(screen.getByText(PRODUCT_DEFAULTS[0].name)).toBeTruthy());
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Save codes")).toBeTruthy();
  });
});
