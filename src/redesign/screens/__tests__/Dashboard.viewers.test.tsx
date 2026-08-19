// Viewer chip (👥 N) — render contract, per Jeff's placement decision:
// next to the "Live comments" label (same row, after the label), small and
// label-weight. null = NO node at all (hidden — no data / not green; the
// green gating lives in RedesignApp on the same booleans as ttConnected);
// a REAL 0 renders as "👥 0"; counts localize (1,234).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";

const noop = () => {};
const baseProps = {
  comments: [], cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {} as Record<string, string>, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (viewers: number | null) =>
  render(<TProvider lang="en"><Dashboard {...baseProps} viewers={viewers} /></TProvider>);

describe("the 👥 viewer chip in the Live-comments row", () => {
  it("null → hidden entirely (no node, not a 0)", () => {
    const { container } = renderDash(null);
    expect(container.textContent).not.toContain("👥");
  });

  it("a REAL 0 renders as 👥 0 (data, not absence)", () => {
    const { getByLabelText } = renderDash(0);
    expect(getByLabelText("Live viewers").textContent).toContain("👥 0");
  });

  it("counts render localized next to the Live comments label", () => {
    const { container, getByLabelText } = renderDash(1234);
    const chip = getByLabelText("Live viewers");
    expect(chip.textContent).toContain((1234).toLocaleString());
    // Same left group as the label — the chip lives in the label's row cluster.
    const label = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === "Live comments")!;
    expect(label.parentElement).toBe(chip.parentElement);
  });

  it("carries the accessibility title (tooltip) too", () => {
    const { getByTitle } = renderDash(42);
    expect(getByTitle("Live viewers").textContent).toContain("42");
  });
});
