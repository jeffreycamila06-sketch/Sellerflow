// 🛒 Per-buyer basket count (Chotdon-inspired): each feed row shows how many
// CREATED ORDERS that buyer has in the CURRENT session window. Pins: count
// correctness (0/1/multi), identity matching (@-strip + handle+platform key),
// 0 → NO badge, reactive update when the counts map changes, and window reset
// (empty buyers → all badges gone). Display-only — the counts derive from the
// existing window-scoped session state (Buyer.totalOrders); no new queries.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import { buildBasketCounts, basketCountFor, buyerBasketKey } from "../../adapters/basketCounts";
import type { Comment } from "../../data";
import type { Buyer } from "../../../lib/orderTypes";

const buyer = (handle: string, platform: string, totalOrders: number): Buyer =>
  ({ handle, name: handle, platform, num: 1, orders: [], totalSpent: 0, totalOrders }) as Buyer;

const comment = (handle: string, platform: string, id = handle): Comment =>
  ({ id, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform });

const noop = () => {};
const props = (comments: Comment[], basketCounts?: Map<string, number>) => ({
  comments, cur: "NT$", basketCounts,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  sessionDays: 1, sessionOpen: false, onToggleSession: noop, onPickSession: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});

describe("basketCounts (pure)", () => {
  it("maps each buyer's totalOrders under the SAME handle+platform key the order logic uses", () => {
    const m = buildBasketCounts([buyer("maria", "TikTok", 3), buyer("ben", "Facebook", 1)]);
    expect(m.get(buyerBasketKey("maria", "TikTok"))).toBe(3);
    expect(m.get(buyerBasketKey("ben", "Facebook"))).toBe(1);
    expect(buyerBasketKey("maria", "TikTok")).toBe("maria TikTok"); // orderLogic key format
  });
  it("identity: same handle on DIFFERENT platforms stays separate", () => {
    const m = buildBasketCounts([buyer("maria", "TikTok", 3), buyer("maria", "Facebook", 5)]);
    expect(basketCountFor(m, "@maria", "TikTok")).toBe(3);
    expect(basketCountFor(m, "@maria", "Facebook")).toBe(5);
  });
  it("basketCountFor strips the display @ and returns 0 for unknown/missing", () => {
    const m = buildBasketCounts([buyer("maria", "TikTok", 2)]);
    expect(basketCountFor(m, "@maria", "TikTok")).toBe(2);
    expect(basketCountFor(m, "maria", "TikTok")).toBe(2);   // raw handle also fine
    expect(basketCountFor(m, "@nobody", "TikTok")).toBe(0); // no orders yet
    expect(basketCountFor(m, "@maria", undefined)).toBe(0); // no platform → no match
    expect(basketCountFor(m, "", "TikTok")).toBe(0);
  });
  it("window reset: empty buyers → empty map (all counts back to 0)", () => {
    expect(buildBasketCounts([]).size).toBe(0);
  });
});

describe("Dashboard 🛒 badge", () => {
  it("shows 🛒N for buyers with orders; NO badge at 0", () => {
    const counts = buildBasketCounts([buyer("maria", "TikTok", 3)]);
    const { container } = render(
      <TProvider lang="en"><Dashboard {...props([comment("maria", "TikTok", "c1"), comment("newbie", "TikTok", "c2")], counts)} /></TProvider>,
    );
    const rows = container.querySelectorAll(".sfl-comm-row");
    expect(rows[0].textContent).toContain("🛒3");     // maria — 3 orders
    expect(rows[1].textContent).not.toContain("🛒");  // newbie — subtle: no badge at all
  });

  it("reactive: a new order (updated counts map) bumps the badge on rerender", () => {
    const c = [comment("maria", "TikTok")];
    const { container, rerender } = render(
      <TProvider lang="en"><Dashboard {...props(c, buildBasketCounts([buyer("maria", "TikTok", 1)]))} /></TProvider>,
    );
    expect(container.querySelector(".sfl-comm-row")!.textContent).toContain("🛒1");
    rerender(<TProvider lang="en"><Dashboard {...props(c, buildBasketCounts([buyer("maria", "TikTok", 2)]))} /></TProvider>);
    expect(container.querySelector(".sfl-comm-row")!.textContent).toContain("🛒2");
  });

  it("no counts map at all (prop omitted) → renders cleanly with no badges", () => {
    const { container } = render(
      <TProvider lang="en"><Dashboard {...props([comment("maria", "TikTok")])} /></TProvider>,
    );
    expect(container.querySelector(".sfl-comm-row")!.textContent).not.toContain("🛒");
  });
});
