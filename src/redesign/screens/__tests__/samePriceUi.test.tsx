// "Same price for all items" — the persistent Live chip (Dashboard, shown only while
// ON). The chip ✕ = same as turning it OFF in Settings: instant off + a toast, the
// price stays remembered — no confirm dialog any more. (The Settings row + sheet
// flow lives in liveSessionSheet.test.tsx.)
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { UseRaffleConfig } from "../../adapters/useRaffleConfig";

const { raffleState } = vi.hoisted(() => ({
  raffleState: { enabled: false, enabledAt: null, loading: false, toggle: async () => {}, toggleErrors: 0 } as UseRaffleConfig,
}));
vi.mock("../../adapters/useRaffleConfig", () => ({ useRaffleConfig: () => raffleState }));

import Dashboard from "../Dashboard";

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

describe("Live chip — shown only while ON", () => {
  it("renders (active price) with the currency + amount", () => {
    render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={199} onDisableSamePrice={noop} /></TProvider>);
    expect(screen.getByTestId("samePrice-chip").textContent).toContain("All items NT$199");
  });

  it("hidden when OFF (active null) or non-positive", () => {
    const { rerender } = render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={null} onDisableSamePrice={noop} /></TProvider>);
    expect(screen.queryByTestId("samePrice-chip")).toBeNull();
    rerender(<TProvider lang="en"><Dashboard {...dashProps} samePrice={0} onDisableSamePrice={noop} /></TProvider>);
    expect(screen.queryByTestId("samePrice-chip")).toBeNull();
  });

  it("✕ turns it OFF immediately — no confirm dialog", () => {
    const onDisable = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    render(<TProvider lang="en"><Dashboard {...dashProps} samePrice={199} onDisableSamePrice={onDisable} /></TProvider>);
    fireEvent.click(screen.getByTestId("samePrice-chip-clear"));
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("chip ✕ handler = setEnabled(false) (price remembered) + the 'Same price off · … remembered' toast", () => {
    const block = src.slice(src.indexOf("onDisableSamePrice={() => {"), src.indexOf("onDisableSamePrice={() => {") + 400);
    expect(block).toContain("samePriceCfg.setEnabled(false)");
    expect(block).toContain("rd_lss_off_sp");
    expect(block).toContain("setToast(");
  });
  it("Settings gets the global toast + the sticker size for the print-pattern row", () => {
    expect(src).toContain("onToast={(msg) => setToast({ msg, kind: \"ok\" })}");
    expect(src).toContain("printSize={psType === \"bt\" || psOut === \"sticker\" ? psSize : undefined}");
  });
});
