// F-batch #3 — iOS PAYMENT-GATE MATRIX (Apple Guideline 2.1b/3.1.1 regression
// insurance while the review is pending). Every payment/subscription surface is
// rendered TWICE — web and iOS (?ios=1, the same override isIOS() honors on
// device) — asserting payment UI is PRESENT on web (the gate is real, not
// vacuous) and ABSENT on iOS. RedesignApp-level gates that can't be rendered in
// isolation are pinned as source contracts (same style as the SQL contract tests).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import Support from "../Support";
import Admin from "../Admin";
import GeneralSettings from "../GeneralSettings";
import ConnectModal from "../ConnectModal";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

// isIOS() honors ?ios=1 — the SAME browser override used for manual iOS testing.
const setIOS = (on: boolean) =>
  Object.defineProperty(window, "location", { value: { ...window.location, search: on ? "?ios=1" : "" }, writable: true });
afterEach(() => setIOS(false));

const wrap = (ui: React.ReactElement) => render(<TProvider lang="en">{ui}</TProvider>);
const noop = () => {};
const auto: AutoControls = { detect: false, setupOpen: false, toggle: noop, toggleSetup: noop };
const account: AccountUser = {
  authUserId: "u1", email: "s@x.com",
  profile: { fullName: "S", storeName: "S", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "2026-12-31", connectedAccounts: [], role: "seller",
};

describe.each([["web", false], ["iOS", true]] as const)("iOS payment-gate matrix — %s", (label, ios) => {
  const assertGate = (payText: RegExp | string) => {
    const q = typeof payText === "string" ? screen.queryByText(payText) : screen.queryByText(payText);
    if (ios) expect(q, `payment UI must be HIDDEN on iOS`).toBeNull();
    else expect(q, `payment UI must EXIST on web (gate not vacuous)`).toBeTruthy();
  };

  it(`gate 1 — Support: "Renewing your subscription" guide (${label})`, () => {
    setIOS(ios);
    wrap(<Support onLegal={noop} />);
    assertGate("Renewing your subscription");
  });

  it(`gate 2 — Admin home: Monthly Revenue card; Plans/Payments GONE everywhere (${label})`, () => {
    setIOS(ios);
    wrap(<Admin onOpenPanel={noop} cur="NT$" mrr={12900} />);
    assertGate(/Monthly revenue/i);
    // C2 (audit) — the Plans/Payments panels were REMOVED entirely (permanently-
    // fake sample data, no backend by design). Absent on BOTH platforms is a
    // strictly stronger Apple-compliance contract than the old iOS-only gate.
    expect(screen.queryByText(/^Plans$/)).toBeNull();
    expect(screen.queryByText(/^Payments$/)).toBeNull();
  });

  it(`gate 3 — GeneralSettings: plan line + Subscription row (${label})`, () => {
    setIOS(ios);
    wrap(<GeneralSettings
      theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop}
      printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={account} onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
    />);
    assertGate("Subscription"); // the settings-list row that opens the payment screen
  });

  it(`gate 4 — ConnectModal at account limit: upgrade copy vs neutral copy (${label})`, () => {
    setIOS(ios);
    // basic plan (cap 1) with the slot consumed by FACEBOOK → the TikTok tab has
    // no usable account and can't add more → the limit banner renders
    const capped: AccountUser = { ...account, plan: "basic", profile: { ...account.profile, facebook: "shop_page" } };
    wrap(<ConnectModal profile={capped} initialTab="TikTok" onClose={noop} onConnect={async () => ({ ok: true, account: "" })} />);
    // web copy sells the upgrade; iOS copy is the neutral limit-only text
    assertGate(/Upgrade to add more/i);
    if (ios) expect(screen.getByText(/account limit is reached\.$/i)).toBeTruthy(); // neutral copy IS shown
  });
});

// ── RedesignApp-level gates (can't render the whole app here) — SOURCE CONTRACTS ──
describe("iOS gates pinned in RedesignApp source", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("gate 5 — the Subscription screen never mounts on iOS", () => {
    expect(src).toContain('{screen === "subscription" && !ios && <Subscription');
  });
  it("gate 6 — free-cap/expired popups: iOS gets the neutral ContactSupportPopup, web keeps CapPopup", () => {
    expect(src).toMatch(/ios[\s\S]{0,200}<ContactSupportPopup/);
    expect(src).toContain("<CapPopup");
  });
  it("gate 7 — Shipping upgrade prompt is withheld on iOS (onUpgrade undefined)", () => {
    expect(src).toContain("onUpgrade={ios ? undefined :");
  });
});
