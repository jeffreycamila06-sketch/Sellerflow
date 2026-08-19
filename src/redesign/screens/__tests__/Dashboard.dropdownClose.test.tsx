// Dropdown dismiss (Jeff bug, 2026-07-12) — the header dropdowns (TikTok/FB
// account pickers) must close on a tap ANYWHERE outside them,
// with NO action triggered (sellers were forced to tap Disconnect just to
// dismiss the panel). Escape closes too. Taps INSIDE the panel (account rows,
// Refresh, Connect/Disconnect) keep working exactly as before. Pure UI — no
// connection logic in this suite's scope.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";

const noop = () => {};
const baseProps = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  ttAccounts: ["msgrey46"], fbAccounts: [],
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};

const renderDash = (over: Partial<typeof baseProps> & Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>);

describe("TikTok dropdown — tap-outside / Escape close (the reported bug)", () => {
  it("pointerdown OUTSIDE the open dropdown → onToggleTT fires (closes) and NO dropdown action runs", () => {
    const onToggleTT = vi.fn(); const onConnectTT = vi.fn(); const onRefreshTT = vi.fn(); const onPickTT = vi.fn();
    renderDash({ ttOpen: true, onToggleTT, onConnectTT, onRefreshTT, onPickTT });
    fireEvent.pointerDown(document.body);                       // tap sa labas (feed / kahit saan)
    expect(onToggleTT).toHaveBeenCalledTimes(1);                // dropdown closes…
    expect(onConnectTT).not.toHaveBeenCalled();                 // …WITHOUT Disconnect
    expect(onRefreshTT).not.toHaveBeenCalled();                 // …without Refresh
    expect(onPickTT).not.toHaveBeenCalled();                    // …without an account pick
  });

  it("pointerdown INSIDE the dropdown does NOT close it; Refresh + Connect/Disconnect + account pick still work on click", () => {
    const onToggleTT = vi.fn(); const onConnectTT = vi.fn(); const onRefreshTT = vi.fn(); const onPickTT = vi.fn();
    const { getByText, getAllByText } = renderDash({ ttOpen: true, onToggleTT, onConnectTT, onRefreshTT, onPickTT });
    const refresh = getByText("Refresh");
    fireEvent.pointerDown(refresh);                             // the tap's press phase lands inside
    expect(onToggleTT).not.toHaveBeenCalled();                  // no premature close
    fireEvent.click(refresh);
    expect(onRefreshTT).toHaveBeenCalledTimes(1);               // Refresh gumagana pa rin
    fireEvent.click(getByText("Connect"));                      // not connected → label "Connect"
    expect(onConnectTT).toHaveBeenCalledTimes(1);               // Connect/Disconnect gumagana pa rin
    const acctRow = getAllByText("msgrey46")[1];                // [0] = chip label, [1] = dropdown row
    fireEvent.click(acctRow);
    expect(onPickTT).toHaveBeenCalledTimes(1);                  // account row gumagana pa rin
  });

  it("Escape key closes the open dropdown", () => {
    const onToggleTT = vi.fn();
    renderDash({ ttOpen: true, onToggleTT });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onToggleTT).toHaveBeenCalledTimes(1);
  });

  it("closed dropdown → outside taps and Escape do NOTHING (listener only attaches while open)", () => {
    const onToggleTT = vi.fn(); const onToggleFB = vi.fn();
    renderDash({ onToggleTT, onToggleFB });
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onToggleTT).not.toHaveBeenCalled();
    expect(onToggleFB).not.toHaveBeenCalled();
  });
});

describe("same behavior for the other header dropdowns (same bug class)", () => {
  it("Facebook dropdown: outside tap closes via onToggleFB only", () => {
    const onToggleFB = vi.fn(); const onConnectFB = vi.fn();
    renderDash({ fbOpen: true, onToggleFB, onConnectFB });
    fireEvent.pointerDown(document.body);
    expect(onToggleFB).toHaveBeenCalledTimes(1);
    expect(onConnectFB).not.toHaveBeenCalled();
  });

  // The session-length pill was REMOVED (sub-step 4) — session length is chosen in
  // the required picker modal on Connect. Its outside-tap-close test is gone with it.
});
