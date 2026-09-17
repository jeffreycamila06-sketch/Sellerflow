// Auto Mode card (Sep 17): the code-list EDITOR moved to the Products screen
// (one code = one product). The expanded card now holds ONLY a pointer + the
// low-stock threshold — no code rows, no product picker, no "Save codes".
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

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

describe("Auto Mode card (Sep 17 — codes moved to Products)", () => {
  beforeEach(() => localStorage.clear());

  it("removed the old trigger-word UI", () => {
    renderGS();
    expect(screen.queryByText("Trigger word sets")).toBeNull();
    expect(screen.queryByText(/word = price/)).toBeNull();
  });

  it("no longer shows the in-Settings code editor (moved to Products)", () => {
    renderGS();
    expect(screen.queryByText("Code → product")).toBeNull();
    expect(screen.queryByText("+ Add code")).toBeNull();
    expect(screen.queryByText("Save codes")).toBeNull();
  });

  it("shows the Products pointer + keeps the low-stock threshold", () => {
    renderGS();
    expect(screen.getByText(/Live codes now live on each Product/)).toBeTruthy();
    expect(screen.getByText("Low-stock warning at")).toBeTruthy();
  });
});
