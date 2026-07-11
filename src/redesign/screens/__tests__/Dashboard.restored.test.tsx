// Duplicate-order LAYER 3 (comment persistence) — restored session-history rows
// are DISPLAY-ONLY in the feed UI. The audit flagged this as the one
// implementation-promise layer (layers 1+2 are structural), so it is pinned
// hard here:
//   • a restored row renders ZERO <button> elements (no 1-Click, no Enterprise,
//     no printed/price UI) and is visually muted;
//   • the "— Session history —" divider renders ONCE, above the first restored
//     row (history block sits below the live block);
//   • the 🛒 basket badge (DB-backed, survives refresh) still shows on history;
//   • live rows keep their full action row — the manual capture flow is intact.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import { buildBasketCounts } from "../../adapters/basketCounts";
import type { Comment } from "../../data";
import type { Buyer } from "../../../lib/orderTypes";

const comment = (handle: string, id = handle, restored = false): Comment =>
  ({ id, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform: "TikTok", ...(restored ? { restored: true } : {}) });

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

const renderFeed = (comments: Comment[], counts?: Map<string, number>) =>
  render(<TProvider lang="en"><Dashboard {...props(comments, counts)} /></TProvider>);

describe("Dashboard restored rows (duplicate-order layer 3)", () => {
  it("a restored row renders ZERO <button> elements; a live row keeps 1-Click + Enterprise", () => {
    const { container } = renderFeed([comment("livebuyer", "c-live"), comment("histbuyer", "c-hist", true)]);
    const rows = container.querySelectorAll(".sfl-comm-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll("button").length).toBeGreaterThanOrEqual(2); // live: Enterprise + 1-Click
    expect(rows[1].querySelectorAll("button").length).toBe(0);                   // restored: NOTHING clickable
    expect(rows[1].textContent).not.toContain("1-Click");
    expect(rows[1].textContent).not.toContain("Enterprise");
  });

  it("restored rows are muted (opacity) — visually history, not live", () => {
    const { container } = renderFeed([comment("histbuyer", "c-hist", true)]);
    const row = container.querySelector(".sfl-comm-row") as HTMLElement;
    expect(Number(row.style.opacity)).toBeLessThan(1);
  });

  it("the Session history divider renders ONCE, above the FIRST restored row only", () => {
    const { container } = renderFeed([
      comment("live1", "c1"), comment("live2", "c2"),
      comment("hist1", "c3", true), comment("hist2", "c4", true),
    ]);
    const matches = (container.textContent!.match(/Session history/g) || []).length;
    expect(matches).toBe(1);
    // divider sits between the live block and the history block
    expect(container.textContent).toMatch(/live2.*Session history.*hist1/s);
  });

  it("no restored rows → no divider (a purely live feed is byte-identical)", () => {
    const { container } = renderFeed([comment("live1", "c1")]);
    expect(container.textContent).not.toContain("Session history");
  });

  it("🛒 basket badge still renders on a restored row (session survives refresh; chat is the only best-effort part)", () => {
    const buyer: Buyer = { handle: "histbuyer", name: "histbuyer", platform: "TikTok", num: 1, orders: [], totalSpent: 0, totalOrders: 3 } as Buyer;
    const { container } = renderFeed([comment("histbuyer", "c-hist", true)], buildBasketCounts([buyer]));
    const row = container.querySelector(".sfl-comm-row")!;
    expect(row.textContent).toContain("🛒3");
    expect(row.querySelectorAll("button").length).toBe(0); // badge is a <span>, still zero buttons
  });

  it("printed / price-entry UI never leaks onto restored rows (even with matching state)", () => {
    const p = props([comment("histbuyer", "c-hist", true)]);
    const { container } = render(
      <TProvider lang="en"><Dashboard {...p} printed={{ "c-hist": "NT$100" }} entId="c-hist" /></TProvider>,
    );
    const row = container.querySelector(".sfl-comm-row")!;
    expect(row.querySelectorAll("button").length).toBe(0);
    expect(row.querySelectorAll("input").length).toBe(0);   // no Enterprise price input
    expect(row.textContent).not.toContain("Printed");
  });
});
