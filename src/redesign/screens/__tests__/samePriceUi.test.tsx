// "Same price for all items" UI — the persistent Live chip (Dashboard) and the
// Settings row (GeneralSettings Live-session accordion).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { UseRaffleConfig } from "../../adapters/useRaffleConfig";
import type { AutoControls } from "../../data";
import type { AccountUser } from "../../../accountDb";

const { raffleState } = vi.hoisted(() => ({
  raffleState: { enabled: false, enabledAt: null, loading: false, toggle: async () => {}, toggleErrors: 0 } as UseRaffleConfig,
}));
vi.mock("../../adapters/useRaffleConfig", () => ({ useRaffleConfig: () => raffleState }));

import Dashboard from "../Dashboard";
import GeneralSettings from "../GeneralSettings";

const noop = () => {};
const dashProps = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

describe("Live chip — 'All items NT$199 · ✕'", () => {
  it("renders while set, with the currency + amount", () => {
    render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={199} onClearSamePrice={noop} /></TProvider>);
    expect(screen.getByTestId("samePrice-chip").textContent).toContain("All items NT$199");
  });

  it("hidden when not set (null) or non-positive", () => {
    const { rerender } = render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={null} onClearSamePrice={noop} /></TProvider>);
    expect(screen.queryByTestId("samePrice-chip")).toBeNull();
    rerender(<TProvider lang="en"><Dashboard {...dashProps} samePrice={0} onClearSamePrice={noop} /></TProvider>);
    expect(screen.queryByTestId("samePrice-chip")).toBeNull();
  });

  it("✕ clears only after the confirm is accepted", () => {
    const onClear = vi.fn();
    render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={199} onClearSamePrice={onClear} /></TProvider>);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("samePrice-chip-clear"));
    expect(onClear).not.toHaveBeenCalled(); // declined
    fireEvent.click(screen.getByTestId("samePrice-chip-clear"));
    expect(onClear).toHaveBeenCalledTimes(1); // accepted
    confirm.mockRestore();
  });
});

const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "Owner", storeName: "Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
function renderGS(over: { samePrice?: number | null; onSave?: (v: unknown) => void; onClear?: () => void } = {}) {
  const auto: AutoControls = { detect: false, setupOpen: false, toggle: noop, toggleSetup: noop };
  return render(
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
        liveSessionOpen onToggleLiveSession={noop}
        cur="NT$" samePrice={over.samePrice ?? null} onSaveSamePrice={over.onSave ?? noop} onClearSamePrice={over.onClear ?? noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
      />
    </TProvider>,
  );
}

describe("Settings row — Same price for all items", () => {
  it("renders the row + note; Save sends the typed value", () => {
    const onSave = vi.fn();
    renderGS({ onSave });
    expect(screen.getByTestId("samePrice-row")).toBeTruthy();
    expect(screen.getByText(/every 1-Click and Auto order prints this price/i)).toBeTruthy(); // the helper note
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "199" } });
    fireEvent.click(screen.getByTestId("samePrice-save"));
    expect(onSave).toHaveBeenCalledWith("199");
  });

  it("Clear button appears only when a price is set, and fires onClearSamePrice", () => {
    const onClear = vi.fn();
    const { rerender } = renderGS({ samePrice: null, onClear });
    expect(screen.queryByTestId("samePrice-clear")).toBeNull();
    rerender(
      <TProvider lang="en">
        <GeneralSettings
          theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
          auto={{ detect: false, setupOpen: false, toggle: noop, toggleSetup: noop }} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
          profileOpen={false} onToggleProfile={noop}
          keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
          liveSessionOpen onToggleLiveSession={noop}
          samePrice={199} onSaveSamePrice={noop} onClearSamePrice={onClear}
          printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
          onSubscription={noop} onSupport={noop} onDelete={noop}
          account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
        />
      </TProvider>,
    );
    fireEvent.click(screen.getByTestId("samePrice-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
