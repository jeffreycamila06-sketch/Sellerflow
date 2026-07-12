// ⚠️ THE DUPE GATE — Approach A (FLive-parity initial comments). The lesson of
// the cancelled F4: history redelivered through the live pipeline mints new
// commentKeys → duplicate auto-orders. This suite pins the safety contract:
//   • initial:true comments NEVER fire the onComment (Auto-Mode) seam;
//   • they NEVER enter feed/feedRef → getComment(initialId) === undefined →
//     the 1-Click/Enterprise handlers hard-return (order creation impossible);
//   • EMPTY-FEED GUARD: a reconnect with a populated feed drops the initial
//     batch entirely (no double-display on health-cycle reconnects);
//   • msgId dedup: repeated connects on a quiet room never double the block;
//   • race safety: a live comment mis-flagged as initial degrades to
//     display-only (the SAFE direction — never an order);
//   • live_session_ended clears the block; account-selection scoping applies.
// Socket stub mirrors useLiveFeed.statusTruth.test.tsx. Tangled-zone parity
// suites (commentKey/dedup) are untouched by the feature and stay green.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed, commentKey, initialKey } from "../useLiveFeed";

type WireComment = Partial<ProdComment> & { initial?: boolean; msgId?: string };

const wire = (n: number, over: WireComment = {}): WireComment => ({
  platform: "TikTok", handle: `buyer${n}`, name: `Buyer ${n}`, comment: `mine ${n}`,
  timestamp: new Date(1760000000000 + n * 1000).toISOString(), time: "9:41:00 PM",
  ...over,
});
const initial = (n: number, over: WireComment = {}): WireComment =>
  wire(n, { initial: true, msgId: `msg-${n}`, ...over });

const handlerFor = (event: string) => H.sockets[0].on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });

beforeEach(() => {
  vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear();
  connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_b" });
});

describe("THE DUPE GATE — initial comments are display-only", () => {
  it("initial batch → onComment seam ZERO times, getComment(initialId) undefined; live comment still fires ONCE", () => {
    const seam = vi.fn();
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com", seam));
    fire("comment", initial(1));
    fire("comment", initial(2));
    expect(result.current.initialComments.length).toBe(2);       // displayed as history
    expect(seam).toHaveBeenCalledTimes(0);                        // Auto Mode unreachable
    expect(result.current.comments.length).toBe(0);               // never in the live feed
    for (const c of result.current.initialComments) {
      expect(result.current.getComment(c.id)).toBeUndefined();    // orders impossible
      expect(c.restored).toBe(true);                              // Dashboard layer-3 branch
    }
    fire("comment", wire(99));                                     // real live comment
    expect(seam).toHaveBeenCalledTimes(1);                         // seam intact
    expect(result.current.comments.length).toBe(1);
    expect(result.current.getComment(result.current.comments[0].id)).toBeDefined();
  });

  it("RACE SAFETY: a live comment mis-classified as initial = display-only, NEVER an order (the safe failure direction)", () => {
    const seam = vi.fn();
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com", seam));
    fire("comment", wire(7, { initial: true, msgId: "race-1" }));  // actually-live, flagged initial
    expect(seam).not.toHaveBeenCalled();                            // no auto-order
    expect(result.current.initialComments.length).toBe(1);          // seller still SEES it
    expect(result.current.getComment(result.current.initialComments[0].id)).toBeUndefined();
  });
});

describe("EMPTY-FEED GUARD — history only on a fresh open", () => {
  it("initial comments arriving while the feed has live comments are DROPPED (no reconnect double-display)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(1));                                       // live feed now populated
    expect(result.current.comments.length).toBe(1);
    fire("comment", initial(1));                                    // forced-fresh reconnect replays the buffer
    fire("comment", initial(2));
    expect(result.current.initialComments.length).toBe(0);          // guard: dropped, no dupes
  });

  it("fresh open (empty feed) → initial accepted; LATER live comments do not evict the block", () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", initial(1));
    expect(result.current.initialComments.length).toBe(1);
    fire("comment", wire(2));                                        // live starts flowing
    expect(result.current.initialComments.length).toBe(1);           // history stays
    expect(result.current.comments.length).toBe(1);
  });
});

describe("dedup + lifecycle", () => {
  it("msgId dedup: the same buffered message relayed twice (repeat connect) renders once", () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", initial(1));
    fire("comment", initial(1));                                     // second connect, same buffer
    fire("comment", initial(1, { timestamp: new Date(1760000005000).toISOString() })); // even with a new server stamp
    expect(result.current.initialComments.length).toBe(1);
  });

  it("initialKey: msgId wins; content key is the fallback (no msgId)", () => {
    const a = { platform: "TikTok", handle: "b1", comment: "mine", msgId: "m1" } as ProdComment & { msgId?: string };
    const b = { ...a, timestamp: "2026-07-11T00:00:00Z" };
    expect(initialKey(a)).toBe(initialKey(b));                       // stamp-independent
    const noId = { platform: "TikTok", sourceUsername: "shop", handle: "b1", comment: "mine" } as ProdComment & { msgId?: string };
    expect(initialKey(noId)).toBe("c:TikTok|shop|b1|mine");
    // and it is NOT the tangled-zone commentKey (separate identity space)
    expect(initialKey(a)).not.toBe(commentKey(a));
  });

  it("live_session_ended clears the history block along with the feed", () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", initial(1));
    expect(result.current.initialComments.length).toBe(1);
    fire("live_session_ended", {});
    expect(result.current.initialComments.length).toBe(0);
    expect(result.current.comments.length).toBe(0);
  });

  it("account-selection scoping applies to initial comments too (account-leak fix intact)", () => {
    const { result } = renderHook(() =>
      useLiveFeed(true, "s@x.com", undefined, { TikTok: "shopA", Facebook: "" }));
    fire("comment", initial(1, { sourceUsername: "shopB" }));        // other account's history
    fire("comment", initial(2, { sourceUsername: "shopA" }));        // selected account
    expect(result.current.initialComments.length).toBe(1);
    expect(result.current.initialComments[0].handle).toBe("@buyer2");
  });

  it("RC1 (clientfix): an initial batch arriving WHILE connect() is in flight SURVIVES the response (the wipe bug)", async () => {
    let resolveConnect!: (v: { ok: boolean; account: string }) => void;
    connectPlatformMock.mockReturnValueOnce(new Promise((res) => { resolveConnect = res; }));
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.connect("TikTok", { username: "shop_b" }); });
    // the server relays the batch DURING the POST — it lands before r.ok:
    fire("comment", initial(1, { sourceUsername: "shop_b" }));
    expect(result.current.initialComments.length).toBe(1);
    await act(async () => { resolveConnect({ ok: true, account: "shop_b" }); await pending; });
    expect(result.current.initialComments.length).toBe(1); // NOT wiped by the connect-ok handler
  });

  it("EXITPATH (live Test 3 repro): page-alive return — batch arrives while the OLD feed is populated + connect in flight → BUFFERED, then flushed after the connect-ok feed clear", async () => {
    let resolveConnect!: (v: { ok: boolean; account: string }) => void;
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(50));                                       // pre-exit live feed still in memory
    expect(result.current.comments.length).toBe(1);
    connectPlatformMock.mockReturnValueOnce(new Promise((res) => { resolveConnect = res; }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.connect("TikTok", { username: "shop_b" }); });
    fire("comment", initial(1));                                     // ring re-emit lands mid-POST, feed NOT empty
    expect(result.current.initialComments.length).toBe(0);          // held in the buffer, not dropped
    await act(async () => { resolveConnect({ ok: true, account: "shop_b" }); await pending; });
    expect(result.current.comments.length).toBe(0);                  // connect-ok cleared the old feed…
    expect(result.current.initialComments.length).toBe(1);           // …and the history block appears
    expect(result.current.initialComments[0].handle).toBe("@buyer1");
  });

  it("EXITPATH: a FAILED connect discards the buffered batch (old feed keeps showing — no double display)", async () => {
    let rejectConnect!: (v: { ok: boolean; error: string; account: string }) => void;
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(50));
    connectPlatformMock.mockReturnValueOnce(new Promise((res) => { rejectConnect = res; }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.connect("TikTok", { username: "shop_b" }); });
    fire("comment", initial(1));
    await act(async () => { rejectConnect({ ok: false, error: "not_live", account: "" }); await pending; });
    expect(result.current.comments.length).toBe(1);                  // old feed intact
    expect(result.current.initialComments.length).toBe(0);           // buffer discarded
    fire("comment", initial(2));                                     // late arrival, no connect in flight
    expect(result.current.initialComments.length).toBe(0);           // plain guard drop — unchanged semantics
  });

  it("F2 (audit): a successful connect/account switch CLEARS the old history block (no cross-account leak)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", initial(1, { sourceUsername: "shop_a" }));       // account A's history accepted
    expect(result.current.initialComments.length).toBe(1);
    await act(async () => { await result.current.connect("TikTok", { username: "shop_b" }); }); // switch to B
    expect(result.current.initialComments.length).toBe(0);          // A's block gone with the feed
    fire("comment", initial(2, { sourceUsername: "shop_b" }));       // B's own batch repopulates
    expect(result.current.initialComments.length).toBe(1);
    expect(result.current.initialComments[0].handle).toBe("@buyer2");
  });

  it("malformed initial entries (no handle/comment) are rejected by the same acceptance floor", () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", { initial: true, msgId: "x", platform: "TikTok", handle: "", comment: "hi" });
    fire("comment", { initial: true, msgId: "y", platform: "TikTok", handle: "b1", comment: "" });
    expect(result.current.initialComments.length).toBe(0);
  });
});
