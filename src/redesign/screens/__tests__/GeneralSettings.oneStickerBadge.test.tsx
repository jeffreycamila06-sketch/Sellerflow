// ONE STICKER: the small "New" badge on the LIVE print pattern menu item (until the seller opens it).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const account: AccountUser = { authUserId: "u1", email: "a@b.c", profile: { fullName: "T", storeName: "S", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" }, plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller" };
const noop = () => {};
const renderGS = (badge: boolean, lang = "en") => {
  const auto: AutoControls = { detect: false, toggle: noop };
  render(
    <TProvider lang={lang}>
      <GeneralSettings theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop} auto={auto} cur="NT$" lang={lang} onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop} printPatternNew={badge}
        onSubscription={noop} onSupport={noop} onDelete={noop} account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop} />
    </TProvider>,
  );
};
const openLive = () => fireEvent.click(screen.getByTestId("ls-header"));

describe("LIVE print pattern — New badge", () => {
  beforeEach(() => { try { localStorage.removeItem("sfl_rd_livesession_open"); } catch { /* */ } });
  it("shows 'New' while the seller has not opened the new screen", () => {
    renderGS(true); openLive();
    expect(screen.getByTestId("ls-print-pattern-new").textContent).toBe("New");
  });
  it("Filipino: 'Bago'", () => { renderGS(true, "fil"); openLive(); expect(screen.getByTestId("ls-print-pattern-new").textContent).toBe("Bago"); });
  it("no badge once opened (or when the new screen is off)", () => { renderGS(false); openLive(); expect(screen.queryByTestId("ls-print-pattern-new")).toBeNull(); });
});
