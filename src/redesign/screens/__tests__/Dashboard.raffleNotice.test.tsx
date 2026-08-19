// Batch D (#10, screen half) — when a raffle-toggle DB write fails, the hook
// reverts the pill (useRaffleConfig.revert.test.tsx proves that); the Dashboard
// must EXPLAIN the flip-back with a transient notice in the header center slot,
// otherwise the revert just looks like a broken switch.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { UseRaffleConfig } from "../../adapters/useRaffleConfig";

const { raffleState } = vi.hoisted(() => ({
  raffleState: { enabled: false, enabledAt: null, loading: false, toggle: async () => {}, toggleErrors: 0 } as UseRaffleConfig,
}));
vi.mock("../../adapters/useRaffleConfig", () => ({ useRaffleConfig: () => raffleState }));

import Dashboard from "../Dashboard";

const noop = () => {};
const props = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

describe("Dashboard raffle-toggle failure notice (Batch D #10)", () => {
  it("toggleErrors bump → the localized save-failed notice renders in the header", () => {
    raffleState.toggleErrors = 1;
    render(<TProvider lang="en"><Dashboard {...props} /></TProvider>);
    expect(screen.getByText(/Couldn't save the Games switch/i)).toBeTruthy();
  });

  it("no failures → no notice", () => {
    raffleState.toggleErrors = 0;
    render(<TProvider lang="en"><Dashboard {...props} /></TProvider>);
    expect(screen.queryByText(/Couldn't save the Games switch/i)).toBeNull();
  });
});
