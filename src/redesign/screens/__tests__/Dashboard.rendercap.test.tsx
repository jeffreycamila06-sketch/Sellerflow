// EVIDENCE + regression for audit #2b (Batch C2): the Dashboard mapped ALL
// comments into the DOM (up to the 5,000-comment feed limit, ~15 nodes each =
// ~75k DOM nodes) with no windowing — the biggest long-live jank source on
// low-end Android WebViews. The feed renders the NEWEST FEED_RENDER_CAP rows
// (comments arrive newest-first) + an honest "older hidden" note; order capture
// is unaffected (1-Click targets recent comments; the full feed stays in state).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));

// jsdom has no Element.scrollTo — the Dashboard's feed autoscroll needs a stub.
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard, { FEED_RENDER_CAP } from "../Dashboard";
import type { Comment } from "../../data";

const mkComments = (n: number): Comment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c-${n - i}`, name: `Buyer ${n - i}`, handle: `@b${n - i}`,
    text: "mine", mine: true, time: "9:41:00 PM",
  }));

const noop = () => {};
const props = (comments: Comment[]) => ({
  comments, cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});

describe("Dashboard feed render cap (audit #2b)", () => {
  it(`a 500-comment feed renders only the newest ${FEED_RENDER_CAP} rows + an "older hidden" note`, () => {
    const { container, getByText } = render(
      <TProvider lang="en"><Dashboard {...props(mkComments(500))} /></TProvider>,
    );
    const rows = container.querySelectorAll(".sfl-comm-row");
    console.log(`EVIDENCE: comments=500 · DOM rows rendered=${rows.length} (cap=${FEED_RENDER_CAP})`);
    expect(rows.length).toBe(FEED_RENDER_CAP);
    expect(getByText(/of 500 comments/)).toBeTruthy(); // the note tells the seller the real total
    // Newest kept: the top row is the newest comment (id c-500 → "Buyer 500").
    expect(rows[0].textContent).toContain("Buyer 500");
  });
  it("small feeds render fully with no note", () => {
    const { container, queryByText } = render(
      <TProvider lang="en"><Dashboard {...props(mkComments(5))} /></TProvider>,
    );
    expect(container.querySelectorAll(".sfl-comm-row").length).toBe(5);
    expect(queryByText(/older comments/i)).toBeNull();
  });
});
