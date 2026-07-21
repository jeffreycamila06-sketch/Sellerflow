// Pins the Settings "Printer" row DEFAULT slot = Bluetooth sticker (index 1), not
// the un-configured WiFi/LAN slot (index 0, whose meta reads "…not set up yet").
// Two complementary guards:
//  (1) BEHAVIORAL — GeneralSettings with printerIdx=1 shows the Bluetooth slot in
//      the collapsed Printer row and NOT the WiFi "not set up yet" copy; printerIdx=0
//      still shows the WiFi slot. This pins the SEMANTICS of index 1 = Bluetooth, so
//      reordering the two slots can't make the default point back at WiFi.
//  (2) SOURCE-CONTRACT — RedesignApp initializes printerIdx to 1. The useState default
//      lives in RedesignApp (not reachable via a GeneralSettings prop), so this grep
//      guards against a silent revert to useState(0).
// printerIdx is DISPLAY-ONLY (GeneralSettings.tsx:135) — it never feeds print routing.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const auto: AutoControls = { detect: false, setupOpen: false, toggle: () => {}, toggleSetup: () => {} };
const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "T", storeName: "S", phone: "0912345678", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};

function renderRow(printerIdx: number) {
  render(
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        printerIdx={printerIdx} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
      />
    </TProvider>,
  );
}

describe("Settings printer row — default slot", () => {
  // The collapsed row renders "{name} · {meta}" as one joined text node, so match
  // on a substring (regex) rather than exact text.
  it("index 1 (the new default) shows the Bluetooth sticker slot, not the WiFi 'not set up yet' copy", () => {
    renderRow(1);
    expect(screen.getByText(/Bluetooth sticker printer/)).toBeTruthy();
    expect(screen.queryByText(/not set up yet/i)).toBeNull();
  });

  it("index 0 is still the WiFi/LAN slot — reachable when the user taps it (nothing removed)", () => {
    renderRow(0);
    expect(screen.getByText(/WiFi \/ LAN receipt printer/)).toBeTruthy();
    expect(screen.getByText(/not set up yet/i)).toBeTruthy();
  });

  it("RedesignApp initializes printerIdx to the Bluetooth slot (1) — guards a silent revert to 0", () => {
    const src = readFileSync(resolve(__dirname, "..", "..", "RedesignApp.tsx"), "utf8");
    expect(src).toMatch(/printerIdx,\s*setPrinterIdx\s*\]\s*=\s*useState\(\s*1\s*\)/);
  });
});
