// EVIDENCE + regression for audit #2a (Batch C2): useLiveFeed rebuilt the
// `comments` array (feed.map(toRedesignComment)) on EVERY render of its host —
// including renders caused by unrelated state (each Enterprise-price keystroke
// re-mapped up to 5,000 comments and forced a full list reconcile). The proof
// is referential identity: with an UNCHANGED feed, an unrelated host re-render
// must return the SAME comments array.
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, act } from "@testing-library/react";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));

import { useLiveFeed, type UseLiveFeed } from "../useLiveFeed";

// Captured via an after-render effect (not during render — hooks-lint-safe).
const probe: { latest?: UseLiveFeed; forceRender: () => void } = { forceRender: () => {} };
function Harness() {
  const [, bump] = useState(0);
  const feed = useLiveFeed(true, "seller@x.com");
  useEffect(() => { probe.latest = feed; probe.forceRender = () => bump((n) => n + 1); });
  return null;
}

describe("useLiveFeed comments memoization (audit #2a)", () => {
  it("unrelated host re-render (e.g. a price keystroke) must NOT rebuild the comments array", async () => {
    render(<Harness />);
    // Feed some comments through the real accepted-comment path.
    await act(async () => {
      probe.latest!.injectSynthetic("A");
      probe.latest!.injectSynthetic("B");
      probe.latest!.injectSynthetic("C");
    });
    const before = probe.latest!.comments;
    expect(before.length).toBe(3);

    await act(async () => { probe.forceRender(); }); // unrelated render — feed unchanged

    const after = probe.latest!.comments;
    console.log(`EVIDENCE: feed unchanged across an unrelated re-render → comments identity ${before === after ? "PRESERVED (memoized)" : "CHANGED (re-mapped every render — wasteful at 5,000 comments)"}`);
    expect(after).toBe(before); // same array reference — no remap, no full-list reconcile
  });
});
