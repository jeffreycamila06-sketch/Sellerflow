// ORDERABLE HISTORY (sql/18) — the restored ("Earlier comments") rows are now
// orderable, with the duplicate protection moved from "no buttons" to the
// DB-backed ordered-check. This suite pins the three history-row states:
//   • historyReady=false (window load unresolved — the E1 gate): DISPLAY-ONLY —
//     muted, ZERO buttons (an already-ordered comment must not look orderable
//     before the check is possible);
//   • historyReady + ordered (msgId matched a loaded order): the REPRINT
//     button (2026-07-12 — replaced the "Ordered ✓" chip; still NO order
//     buttons, so no re-order path);
//   • historyReady + not ordered: full live action row (1-Click + Enterprise).
// Plus: divider renders once above the first restored row; basket badge shows
// in every state; live rows unaffected.
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

const comment = (handle: string, id = handle, over: Partial<Comment> = {}): Comment =>
  ({ id, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform: "TikTok", ...over });
const hist = (handle: string, id = handle, over: Partial<Comment> = {}): Comment =>
  comment(handle, id, { restored: true, msgId: `m-${id}`, ...over });

const noop = () => {};
const props = (comments: Comment[], historyReady = true, basketCounts?: Map<string, number>) => ({
  comments, cur: "NT$", basketCounts, historyReady,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  sessionDays: 1, sessionOpen: false, onToggleSession: noop, onPickSession: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});

const renderFeed = (comments: Comment[], historyReady = true, counts?: Map<string, number>) =>
  render(<TProvider lang="en"><Dashboard {...props(comments, historyReady, counts)} /></TProvider>);

describe("history rows — the three states (sql/18)", () => {
  it("E1 GATE: historyReady=false → history row is display-only (ZERO buttons, muted) even though unordered", () => {
    const { container } = renderFeed([hist("histbuyer", "c-hist")], false);
    const row = container.querySelector(".sfl-comm-row") as HTMLElement;
    expect(row.querySelectorAll("button").length).toBe(0);   // no orderable UI before the check is possible
    expect(Number(row.style.opacity)).toBeLessThan(1);        // visually "checking", not live
    expect(row.textContent).not.toContain("Ordered");
  });

  it("historyReady + NOT ordered → full live action row (1-Click + Enterprise), unmuted", () => {
    const { container } = renderFeed([hist("histbuyer", "c-hist")], true);
    const row = container.querySelector(".sfl-comm-row") as HTMLElement;
    expect(row.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
    expect(row.textContent).toContain("1-Click");
    expect(row.textContent).toContain("Enterprise");
    expect(row.style.opacity).toBe("");                       // orderable history is not muted
  });

  it("historyReady + ORDERED (msgId matched) → the REPRINT button (chip replaced, 2026-07-12), NO order buttons", () => {
    const { container } = renderFeed([hist("histbuyer", "c-hist", { ordered: true })], true);
    const row = container.querySelector(".sfl-comm-row") as HTMLElement;
    const buttons = row.querySelectorAll("button");
    expect(buttons.length).toBe(1);                          // exactly ONE clean button (FLive style)
    expect(buttons[0].textContent).toContain("Reprint");
    expect(row.textContent).not.toContain("Ordered ✓");      // the old chip is gone
    expect(row.textContent).not.toContain("1-Click");        // still no re-order path
    expect(row.textContent).not.toContain("Enterprise");
  });

  it("live rows are unaffected by the gate (buttons with historyReady=false too)", () => {
    const { container } = renderFeed([comment("livebuyer", "c-live")], false);
    const row = container.querySelector(".sfl-comm-row")!;
    expect(row.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
  });
});

describe("history block chrome (unchanged)", () => {
  it("the Earlier-comments divider renders ONCE, above the FIRST restored row only", () => {
    const { container } = renderFeed([
      comment("live1", "c1"), comment("live2", "c2"),
      hist("hist1", "c3"), hist("hist2", "c4"),
    ]);
    expect((container.textContent!.match(/Earlier comments/g) || []).length).toBe(1);
    expect(container.textContent).toMatch(/live2.*Earlier comments.*hist1/s);
  });

  it("no restored rows → no divider (a purely live feed is byte-identical)", () => {
    const { container } = renderFeed([comment("live1", "c1")]);
    expect(container.textContent).not.toContain("Earlier comments");
  });

  it("🛒 basket badge renders in ALL history states (checking / orderable / ordered)", () => {
    const buyer: Buyer = { handle: "histbuyer", name: "histbuyer", platform: "TikTok", num: 1, orders: [], totalSpent: 0, totalOrders: 3 } as Buyer;
    const counts = buildBasketCounts([buyer]);
    for (const [ready, over] of [[false, {}], [true, {}], [true, { ordered: true }]] as Array<[boolean, Partial<Comment>]>) {
      const { container, unmount } = renderFeed([hist("histbuyer", "c-hist", over)], ready, counts);
      expect(container.querySelector(".sfl-comm-row")!.textContent).toContain("🛒3");
      unmount();
    }
  });

  it("printed marks work on an ordered-now history row (same flow as live rows): REPRINT button replaces the actions", () => {
    const p = props([hist("histbuyer", "c-hist")], true);
    const { container } = render(
      <TProvider lang="en"><Dashboard {...p} printed={{ "c-hist": "NT$100" }} /></TProvider>,
    );
    const row = container.querySelector(".sfl-comm-row")!;
    const buttons = row.querySelectorAll("button");
    expect(buttons.length).toBe(1);                          // one clean Reprint button (chip replaced, 2026-07-12)
    expect(buttons[0].textContent).toContain("Reprint");
    expect(row.textContent).not.toContain("1-Click");        // order actions stay gone after ordering
  });
});
