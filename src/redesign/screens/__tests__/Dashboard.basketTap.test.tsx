// BASKET LIST (paid plans, 2026-11-28): with onBasketTap the 🛒N badge is a button that hands the
// row's comment to the parent; without it the badge is the SAME plain <span> as before (free plan).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import { buildBasketCounts } from "../../adapters/basketCounts";
import type { Comment } from "../../data";
import type { Buyer } from "../../../lib/orderTypes";

const buyer = (handle: string, platform: string, totalOrders: number): Buyer =>
  ({ handle, name: handle, platform, num: 1, orders: [], totalSpent: 0, totalOrders }) as Buyer;
const comment = (handle: string, platform: string, id = handle): Comment =>
  ({ id, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform });
const noop = () => {};
const props = (comments: Comment[], extra: object = {}) => ({
  comments, cur: "NT$", basketCounts: buildBasketCounts([buyer("maria", "TikTok", 3)]),
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop, ...extra,
});
// main's badge, copied from Dashboard.tsx on main ac710a84 (the free-plan markup must stay this).
const MAIN_BADGE = '<span class="sfl-basket-badge" title="Orders this session" style="display: inline-flex; align-items: center; font-weight: 800; color: var(--accent-fg); background: var(--accent-soft); border-radius: 999px; flex-shrink: 0;">🛒3</span>';

describe("🛒 badge — tappable only with onBasketTap", () => {
  it("without it: the same plain span as main, no button", () => {
    const { container } = render(<TProvider lang="en"><Dashboard {...props([comment("maria", "TikTok")])} /></TProvider>);
    expect(container.querySelector('[data-testid="basket-badge-btn"]')).toBeNull();
    expect(container.querySelector(".sfl-basket-badge")!.outerHTML).toBe(MAIN_BADGE);
  });
  it("with it: a button (44 px tap area) that gives the row's comment", () => {
    const onBasketTap = vi.fn();
    const { container } = render(<TProvider lang="en"><Dashboard {...props([comment("maria", "TikTok", "c1"), comment("newbie", "TikTok", "c2")], { onBasketTap })} /></TProvider>);
    const btns = container.querySelectorAll('[data-testid="basket-badge-btn"]');
    expect(btns).toHaveLength(1);                      // 0 orders → no badge at all, as before
    const b = btns[0] as HTMLButtonElement;
    expect(b.tagName).toBe("BUTTON");
    expect(b.type).toBe("button");
    expect(b.className).toContain("sfl-basket-badge");
    expect(b.className).toContain("sfl-tap44");
    expect(b.textContent).toBe("🛒3");
    expect(b.getAttribute("aria-label")).toBe("See this buyer's 3 orders");
    expect(container.querySelectorAll("span.sfl-basket-badge")).toHaveLength(0);
    fireEvent.click(b);
    expect(onBasketTap).toHaveBeenCalledTimes(1);
    expect(onBasketTap.mock.calls[0][0]).toMatchObject({ id: "c1", handle: "@maria", platform: "TikTok" });
  });
  it("the tap opens nothing else (no 1-Click, no Type price)", () => {
    const onOneClick = vi.fn(), onOpenEnt = vi.fn();
    const { container } = render(<TProvider lang="en"><Dashboard {...props([comment("maria", "TikTok")], { onBasketTap: vi.fn(), onOneClick, onOpenEnt })} /></TProvider>);
    fireEvent.click(container.querySelector('[data-testid="basket-badge-btn"]')!);
    expect(onOneClick).not.toHaveBeenCalled();
    expect(onOpenEnt).not.toHaveBeenCalled();
  });
});
