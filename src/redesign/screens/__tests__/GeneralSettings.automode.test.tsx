// Auto Mode row: the code-list EDITOR moved to the Products screen (Sep 17, one
// code = one product) and — per the approved mockup — the row is now a plain title +
// toggle. No ▾ expand, no "Live codes now live…" pointer, and the low-stock
// threshold moved to the top of the Products screen.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const auto: AutoControls = { detect: true, toggle: () => {} };
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
  beforeEach(() => { localStorage.clear(); localStorage.setItem("sfl_rd_livesession_open", "1"); }); // LIVE session group open so its content renders

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

  it("Auto mode is a plain title + toggle: no ▾ expand, no pointer, no low-stock threshold", () => {
    renderGS();
    const body = screen.getByTestId("ls-body");
    expect(within(body).getByText("Auto mode")).toBeTruthy();
    expect(screen.getByTestId("ls-tg-auto").getAttribute("aria-checked")).toBe("true");
    expect(within(body).queryByText("▾")).toBeNull();
    expect(screen.queryByText(/Live codes now live on each Product/)).toBeNull();
    expect(screen.queryByText("Low-stock warning at")).toBeNull(); // moved to Products
  });
});
