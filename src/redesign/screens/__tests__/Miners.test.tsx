// Miners empty-state vs real-data (Option a; F-batch: the `live` prop is gone — the screen is live-only). New user (0 customers) must see clean zeros
// + guidance, NEVER the "1,284 / 1.28M / +12%" demo. A user with data sees real numbers.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Miners, { type MinerStats } from "../Miners";
import { TProvider } from "../../i18n";

const zeroStats: MinerStats = { buyers: 0, orders: 0, spent: 0, avg: 0, tiktokPct: 0, fbPct: 0 };
const renderM = (props: Parameters<typeof Miners>[0]) =>
  render(
    <TProvider lang="en">
      <Miners {...props} />
    </TProvider>,
  );

describe("Miners — empty-state (new user) never shows demo", () => {
  it("live + 0 buyers → clean zeros, guidance message, NO demo numbers/badges", () => {
    renderM({ cur: "NT$", miners: [], stats: zeroStats });
    // guidance empty-state
    expect(screen.getByText(/connect an account and start a live session/i)).toBeTruthy();
    // real zeros shown
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // NONE of the hardcoded demo values / fake growth badges
    expect(screen.queryByText("1,284")).toBeNull();
    expect(screen.queryByText("3,947")).toBeNull();
    expect(screen.queryByText(/1\.28M/)).toBeNull();
    expect(screen.queryByText(/\+12%/)).toBeNull();
    expect(screen.queryByText(/\+8%/)).toBeNull();
    // no demo buyer rows
    expect(screen.queryByText("Maria Santos")).toBeNull();
  });

  it("live + real data → shows real numbers + real top buyer, no demo", () => {
    renderM({
      cur: "NT$",
      miners: [{ name: "Ann Cruz", handle: "@anncruz", orders: 4, spent: 1200, platform: "TikTok" }],
      stats: { buyers: 33, orders: 62, spent: 24500, avg: 395, tiktokPct: 70, fbPct: 30 },
    });
    expect(screen.getByText("33")).toBeTruthy();
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("Ann Cruz")).toBeTruthy();
    expect(screen.queryByText("1,284")).toBeNull();
    expect(screen.queryByText("Maria Santos")).toBeNull();
    // empty-state guidance NOT shown when there are buyers
    expect(screen.queryByText(/connect an account and start a live session/i)).toBeNull();
  });
});
