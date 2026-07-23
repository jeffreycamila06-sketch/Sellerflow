// Printer setup flow (2026-07-23): the no-printer modal → CHOICE (not a pre-committed
// tab); picking a not-set-up type → setup GUIDE first; BT setup subtitle is
// Bluetooth-accurate. RedesignApp wiring is pinned as a source contract (the full
// authed app is impractical to mount — same idiom as iosGates / buyerLine); the
// GeneralSettings picker + PrinterSettings subtitle are pinned behaviorally.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import GeneralSettings from "../GeneralSettings";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const t = buildT("en") as unknown as Record<string, string>;
const auto: AutoControls = { detect: false, setupOpen: false, toggle: () => {}, toggleSetup: () => {} };
const account: AccountUser = {
  authUserId: "u1", email: "s@x.com",
  profile: { fullName: "T", storeName: "S", phone: "0912345678", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};

// ── (A/B/C) RedesignApp wiring — source contract ────────────────────────────
describe("RedesignApp printer-flow wiring (source contract)", () => {
  const src = readFileSync(join(__dirname, "../../RedesignApp.tsx"), "utf-8");

  it("A: the no-printer modal lands on the CHOICE (Settings + picker open), NOT a pre-committed tab", () => {
    // onGoSettings opens Settings with the picker + a focus nonce…
    expect(src).toMatch(/onGoSettings=\{\(\)\s*=>\s*\{[^}]*setScreen\("settings"\)[^}]*setPrinterOpen\(true\)[^}]*setPrinterFocus/);
    // …and does NOT pre-commit a tab (no setPsType / no jump to printersettings in that handler).
    const h = src.slice(src.indexOf("onGoSettings={"), src.indexOf("onDismiss={() => setPrinterModal(null)}"));
    expect(h).not.toMatch(/setPsType/);
    expect(h).not.toMatch(/setScreen\("printersettings"\)/);
  });

  it("B/C: picking a type shows the GUIDE when not set up, else goes straight to setup", () => {
    const p = src.slice(src.indexOf("onPickPrinter={(i, alreadySetUp)"), src.indexOf("onPrintPattern={"));
    expect(p).toMatch(/const kind = i === 0 \? "wifi" : "bt"; setPsType\(kind\)/);
    expect(p).toMatch(/if \(alreadySetUp\) setScreen\("printersettings"\); else setPrinterGuide\(kind\)/);
  });

  it("guide OK reveals the setup screen; ✕ just closes", () => {
    const g = src.slice(src.indexOf("<PrinterGuideModal"), src.indexOf("/>", src.indexOf("<PrinterGuideModal")) + 2);
    expect(g).toMatch(/onOk=\{\(\)\s*=>\s*\{\s*setPrinterGuide\(null\);\s*setScreen\("printersettings"\);\s*\}\}/);
    expect(g).toMatch(/onClose=\{\(\)\s*=>\s*setPrinterGuide\(null\)\}/);
  });
});

// ── (B/C) GeneralSettings picker passes alreadySetUp ────────────────────────
describe("Settings CHOOSE PRINTER picker passes the set-up flag", () => {
  it("picking a slot on web (no native bridge) calls onPickPrinter(i, false) → guide will show", () => {
    const onPickPrinter = vi.fn();
    render(
      <TProvider lang="en">
        <GeneralSettings
          theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
          auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
          profileOpen={false} onToggleProfile={noop}
          printerIdx={1} printerOpen={true} onTogglePrinter={noop} onPickPrinter={onPickPrinter} onPrintPattern={noop}
          onSubscription={noop} onSupport={noop} onDelete={noop}
          account={account} onSaveProfile={async () => ({ ok: true })} onManageChannel={noop}
        />
      </TProvider>,
    );
    fireEvent.click(screen.getByText(t.rd_set_prn_wifi)); // WiFi slot (i=0)
    expect(onPickPrinter).toHaveBeenCalledWith(0, false);
    fireEvent.click(screen.getByText(t.rd_set_prn_bt));   // BT slot (i=1)
    expect(onPickPrinter).toHaveBeenCalledWith(1, false);
  });
});

// ── (D) Bluetooth setup subtitle is Bluetooth-accurate ──────────────────────
describe("PrinterSettings subtitle (task D)", () => {
  const renderPS = (psType: "wifi" | "bt") =>
    render(
      <TProvider lang="en">
        <PrinterSettings onBack={noop} psType={psType} psOut="sticker" onSetPsOut={noop}
          psSize="100x60mm (Standard)" psSizeOpen={false} onTogglePsSize={noop} onPickPsSize={noop} />
      </TProvider>,
    );

  it("BT screen shows 'No Bluetooth printer paired' — NOT a WiFi-flavoured line", () => {
    renderPS("bt");
    expect(screen.getByText(t.rd_ps_bt_none)).toBeTruthy();
    expect(screen.queryByText(/WiFi printer saved|No WiFi/i)).toBeNull();
  });

  it("WiFi screen does NOT show the Bluetooth subtitle (left correct)", () => {
    renderPS("wifi");
    expect(screen.queryByText(t.rd_ps_bt_none)).toBeNull();
  });
});

// ── (addendum) the focus scroll is a genuine ONE-SHOT ───────────────────────
// GeneralSettings is CONDITIONALLY mounted (screen === "settings"). Before the
// one-shot fix, printerFocus stayed > 0 after the modal used it, so the scroll
// effect re-fired on EVERY later mount — auto-scrolling to the printer section on
// plain Settings opens for the rest of the session. The fix consumes the intent
// (onPrinterFocused → parent resets printerFocus to 0). This pins: scroll on the
// modal-triggered arrival, NOT on a subsequent plain remount.
describe("printer-focus scroll is one-shot (survives remount)", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { scrollSpy = vi.fn(); (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy; });
  afterEach(() => { delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView; });

  const baseProps = {
    theme: "light" as const, accent: "indigo" as const, onSetTheme: noop, onSetAccent: noop,
    auto, cur: "NT$", lang: "en", onSetLang: noop, currency: "TWD", onSetCurrency: noop,
    profileOpen: false, onToggleProfile: noop,
    printerIdx: 1, printerOpen: false, onTogglePrinter: noop, onPickPrinter: noop, onPrintPattern: noop,
    onSubscription: noop, onSupport: noop, onDelete: noop,
    account, onSaveProfile: async () => ({ ok: true }), onManageChannel: noop,
  };

  // Mirrors RedesignApp's wiring: printerFocus state, onPrinterFocused resets it to
  // 0, and GeneralSettings is conditionally mounted (`show` = navigated to Settings).
  function Harness({ show }: { show: boolean }) {
    const [pf, setPf] = useState(1); // arrives from the no-printer modal (nonce bumped to 1)
    return (
      <TProvider lang="en">
        {show && <GeneralSettings {...baseProps} printerFocus={pf} onPrinterFocused={() => setPf(0)} />}
      </TProvider>
    );
  }

  it("scrolls on the modal-triggered arrival, but NOT on a later plain open", () => {
    const { rerender } = render(<Harness show={true} />);
    // Arrival from the modal (printerFocus starts > 0) → scrolled exactly once.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // Leave Settings (unmount), then open Settings again normally (remount). The
    // Harness (and its printerFocus, now consumed to 0) persists across the toggle.
    rerender(<Harness show={false} />);
    rerender(<Harness show={true} />);
    // Still exactly once — the intent was consumed; no auto-scroll on the plain open.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
