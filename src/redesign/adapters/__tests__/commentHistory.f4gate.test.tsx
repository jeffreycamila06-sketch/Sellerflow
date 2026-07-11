// ⚠️ THE F4 GATE — the #1 test of the comment-persistence spec (the lesson of
// the CANCELLED F4 / server-replay design): restored comments are DISPLAY-ONLY
// and can NEVER reach the Auto-Mode matcher or order creation.
//   Layer 1 — restored comments never enter useLiveFeed → the onComment seam
//             (Auto Mode) fires ZERO times for them, while a live socket
//             comment still fires it exactly once (seam intact).
//   Layer 2 — restored ids never reach feedRef → getComment(restoredId) is
//             undefined → RedesignApp's onOneClick/onEntKey hard-return before
//             orders.createOrder (RedesignApp.tsx:560/573).
// Layer 3 (no action row on restored rows) is pinned in Dashboard.restored.test.
// Socket stub mirrors useLiveFeed.statusTruth.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

const M = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })),
  insert: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "uid1" }, access_token: "tok" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ insert: (...a: unknown[]) => M.insert(...(a as [unknown])) }),
    rpc: (...a: unknown[]) => M.rpc(...(a as [string, unknown])),
  },
}));

import { useLiveFeed, commentKey } from "../useLiveFeed";
import { useCommentHistory, mergeForDisplay, toTuple } from "../commentHistory";

const mk = (n: number): ProdComment => ({
  platform: "TikTok", sourceUsername: "", sessionId: "", handle: `buyer${n}`,
  name: `Buyer ${n}`, comment: `mine ${n}`, isBuy: true, buyerNum: null, buyerData: null,
  time: "9:41:00 PM", timestamp: new Date(1760000000000 + n * 1000).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  H.sockets.length = 0;
  localStorage.clear();
  M.rpc.mockResolvedValue({ data: [toTuple(mk(1)), toTuple(mk(2))], error: null });
  M.insert.mockResolvedValue({ error: null });
});

// The exact RedesignApp composition: useLiveFeed(onComment = Auto-Mode seam) +
// useCommentHistory(rawFeed) + mergeForDisplay.
const setup = (onComment: (c: ProdComment) => void) =>
  renderHook(() => {
    const feed = useLiveFeed(true, "seller@x.com", onComment);
    const history = useCommentHistory(true, "seller@x.com", "2026-07-11", feed.rawFeed);
    const comments = mergeForDisplay(feed.comments, history.restored);
    return { feed, history, comments };
  });

describe("THE F4 GATE — restored comments cannot reach Auto Mode or order creation", () => {
  it("restore N → onComment seam fired ZERO times; a live socket comment still fires it ONCE; getComment(restoredId) === undefined", async () => {
    const seam = vi.fn();
    const { result } = setup(seam);

    // Restored history arrives (2 comments from the RPC)…
    await waitFor(() => expect(result.current.history.restored.length).toBe(2));
    // …and appears in the DISPLAY merge…
    expect(result.current.comments.filter((c) => c.restored).length).toBe(2);
    // …but the Auto-Mode seam NEVER saw them (layer 1):
    expect(seam).toHaveBeenCalledTimes(0);
    // …and neither did feedRef — order creation is structurally impossible (layer 2):
    const restoredId = commentKey(mk(1));
    expect(result.current.feed.getComment(restoredId)).toBeUndefined();

    // The seam itself is INTACT: a real socket comment fires it exactly once.
    const socket = H.sockets[0];
    const onCommentHandler = socket.on.mock.calls.find((c) => c[0] === "comment")?.[1] as (d: ProdComment) => void;
    const live = mk(99);
    await act(async () => { onCommentHandler(live); });
    expect(seam).toHaveBeenCalledTimes(1);
    expect(seam).toHaveBeenCalledWith(expect.objectContaining({ handle: "buyer99" }));
    // The LIVE comment IS resolvable (the 1-Click path works for live rows)…
    expect(result.current.feed.getComment(commentKey(live))).toBeDefined();
    // …while the restored ids stay unresolvable even after live traffic:
    expect(result.current.feed.getComment(restoredId)).toBeUndefined();
  });

  it("overlap: a comment that is BOTH restored and live renders once, resolves as LIVE (safe to order)", async () => {
    const seam = vi.fn();
    const { result } = setup(seam);
    await waitFor(() => expect(result.current.history.restored.length).toBe(2));
    const socket = H.sockets[0];
    const onCommentHandler = socket.on.mock.calls.find((c) => c[0] === "comment")?.[1] as (d: ProdComment) => void;
    await act(async () => { onCommentHandler(mk(1)); });          // same comment arrives live (overlap)
    const id = commentKey(mk(1));
    const rendered = result.current.comments.filter((c) => c.id === id);
    expect(rendered.length).toBe(1);                               // exactly once
    expect(rendered[0].restored).toBeUndefined();                  // the LIVE copy won
    expect(result.current.feed.getComment(id)).toBeDefined();      // orderable as live — correct
    expect(seam).toHaveBeenCalledTimes(1);                         // live delivery fired the seam once
  });
});
