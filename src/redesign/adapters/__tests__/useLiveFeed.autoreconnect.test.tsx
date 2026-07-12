// MANUAL-CONNECT-ONLY (Jeff decision 2026-07-12) — the Fix B client
// auto-reconnect (re-POST /connect after a socket reconnect: the app-open /
// return-from-background auto path) is REMOVED. It bypassed the hook's
// connect() (direct connectPlatform) so the initial-comments flow broke on
// every auto trigger, while the manual Connect tap is the one perfect path.
// This suite pins the NEW contract (it replaces the old Fix B suite):
//   • NO socket event — first connect, RE-connect, drop→reconnect — ever
//     re-POSTs /connect (zero connectPlatform calls without a user tap);
//   • FIX2 — the room join itself is gated on USER INTENT: a fresh mount /
//     login NEVER emits join_live_room (the automatic join + the server's
//     join snapshot were what auto-greened the pill with zero user action —
//     the server-side connection stays alive via the health machinery);
//   • the Connect tap joins at connect INITIATION (before the POST — the
//     initial batch is relayed mid-POST and needs the socket in the room),
//     and AFTER the tap every socket reconnect re-joins + re-sends the
//     selection (mid-live join-snapshot resilience intact);
//   • a user switch (new email) resets the intent — the next page session
//     starts gray again;
//   • the manual connect() path is unchanged;
//   • the dead-socket grace (SOCKET_GRACE_MS honest gray) still works —
//     mid-live STATUS resilience is intact (server-side health-cycle
//     reconnects are a server concern and keep running regardless).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Controllable socket stub (mirror useLiveFeed.connect/scoping tests).
const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
// connectPlatform = the POST to Render; keep the rest of connect.ts real.
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed, SOCKET_GRACE_MS } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fireConnect = () => act(() => { handlerFor("connect")?.(); });
const fireDisconnect = () => act(() => { handlerFor("disconnect")?.(); });
const firePlatformStatus = (d: unknown) => act(() => { handlerFor("platform_status")?.(d); });

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); vi.useFakeTimers(); connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_tt" }); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("manual-connect-only — no socket event ever auto-POSTs /connect", () => {
  it("first socket connect → ZERO re-POSTs (and none pending on any timer)", () => {
    renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(connectPlatformMock).not.toHaveBeenCalled();
  });

  it("connected account + socket drop + RE-connect (the old Fix B trigger) → STILL zero auto re-POSTs", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); }); // the user's tap
    expect(connectPlatformMock).toHaveBeenCalledTimes(1);            // manual POST only
    firePlatformStatus({ platform: "TikTok", connected: true, username: "shop_tt" });
    fireDisconnect();                                                // background / server restart
    fireConnect();                                                   // socket comes back
    act(() => { vi.advanceTimersByTime(120_000); });                 // any old jitter window elapses
    expect(connectPlatformMock).toHaveBeenCalledTimes(1);            // NO auto re-POST — the tap is the only entry
  });

  it("FIX2 — fresh open with an ALIVE server connection → ZERO join_live_room + HONEST GRAY (no zombie green: outside the room, no status event can even reach this socket)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, { TikTok: "shop_tt", Facebook: "" }));
    fireConnect();                                                   // fresh open / login — server connection still alive
    act(() => { vi.advanceTimersByTime(120_000); });
    const joins = sock().emit.mock.calls.filter((c) => c[0] === "join_live_room");
    expect(joins.length).toBe(0);                                    // never in the room → the join snapshot can't green us
    expect(result.current.ttConnected).toBe(false);                  // honest gray + Connect button (Jeff's option b)
    expect(result.current.fbConnected).toBe(false);
    expect(connectPlatformMock).not.toHaveBeenCalled();              // and nothing auto-POSTs
  });

  it("FIX2 — the Connect tap joins the room AT INITIATION (before the POST resolves: the initial batch is relayed mid-POST)", async () => {
    let resolveConnect!: (v: { ok: boolean; account: string }) => void;
    connectPlatformMock.mockReturnValueOnce(new Promise((res) => { resolveConnect = res; }));
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, { TikTok: "shop_tt", Facebook: "" }));
    fireConnect();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.connect("TikTok", { username: "shop_tt" }); });
    // join + selection already on the wire while the POST is still in flight:
    expect(sock().emit.mock.calls.filter((c) => c[0] === "join_live_room").length).toBe(1);
    expect(sock().emit.mock.calls.filter((c) => c[0] === "select_account").length).toBeGreaterThanOrEqual(2);
    await act(async () => { resolveConnect({ ok: true, account: "shop_tt" }); await pending; });
  });

  it("FIX2 — AFTER the tap, a socket drop→reconnect re-joins + re-sends selection (mid-live snapshot resilience intact)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, { TikTok: "shop_tt", Facebook: "" }));
    fireConnect();
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); }); // the user's tap
    const joinsAfterTap = sock().emit.mock.calls.filter((c) => c[0] === "join_live_room").length;
    fireDisconnect();                                                // transport blip / server restart
    fireConnect();                                                   // socket comes back
    const joins = sock().emit.mock.calls.filter((c) => c[0] === "join_live_room");
    expect(joins.length).toBe(joinsAfterTap + 1);                    // re-joined — the join snapshot re-asserts truth
    expect(connectPlatformMock).toHaveBeenCalledTimes(1);            // still zero auto re-POSTs
  });

  it("FIX2 — a user switch (new email) RESETS the intent: the new subscription never joins until its own tap", async () => {
    const { result, rerender } = renderHook(({ em }) => useLiveFeed(true, em), { initialProps: { em: "a@x.com" } });
    fireConnect();
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); }); // user A taps
    expect(H.sockets[0].emit.mock.calls.filter((c) => c[0] === "join_live_room").length).toBe(1);
    rerender({ em: "b@x.com" });                                     // logout/login as another user → new socket
    expect(H.sockets.length).toBe(2);
    const s2 = H.sockets[1];
    const connect2 = s2.on.mock.calls.find((c) => c[0] === "connect")?.[1] as (() => void) | undefined;
    act(() => { connect2?.(); });                                    // new socket connects
    expect(s2.emit.mock.calls.filter((c) => c[0] === "join_live_room").length).toBe(0); // no inherited intent
  });

  it("dead-socket honest gray still works: drop with a green pill → gray after SOCKET_GRACE_MS, and NOTHING reconnects for the seller", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    firePlatformStatus({ platform: "TikTok", connected: true, username: "shop_tt" });
    expect(result.current.ttConnected).toBe(true);
    fireDisconnect();
    act(() => { vi.advanceTimersByTime(SOCKET_GRACE_MS + 1000); });
    expect(result.current.ttConnected).toBe(false);     // honest gray → the seller sees the Connect button
    expect(connectPlatformMock).not.toHaveBeenCalled(); // manual is the only way back
  });

  it("the manual connect() path: POST + account confirmed via the STATUS EVENT (connect-truth: no more optimistic r.ok account)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => {
      const r = await result.current.connect("TikTok", { username: "shop_tt" });
      expect(r.ok).toBe(true);
    });
    expect(connectPlatformMock).toHaveBeenCalledTimes(1);
    expect(result.current.activeAccounts.TikTok).toBe("");           // r.ok alone sets nothing (connect-truth)
    firePlatformStatus({ platform: "TikTok", connected: true, username: "shop_tt" }); // the server's assertion
    expect(result.current.activeAccounts.TikTok).toBe("shop_tt");    // server-driven
    expect(result.current.ttConnected).toBe(true);
  });
});
