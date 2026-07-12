// MANUAL-CONNECT-ONLY (Jeff decision 2026-07-12) — the Fix B client
// auto-reconnect (re-POST /connect after a socket reconnect: the app-open /
// return-from-background auto path) is REMOVED. It bypassed the hook's
// connect() (direct connectPlatform) so the initial-comments flow broke on
// every auto trigger, while the manual Connect tap is the one perfect path.
// This suite pins the NEW contract (it replaces the old Fix B suite):
//   • NO socket event — first connect, RE-connect, drop→reconnect — ever
//     re-POSTs /connect (zero connectPlatform calls without a user tap);
//   • a socket (re)connect still re-joins the room + re-sends the account
//     selection (the join snapshot re-asserts true status — untouched);
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

  it("socket (re)connect still re-joins the room + re-sends selection (snapshot machinery intact)", () => {
    renderHook(() => useLiveFeed(true, "g@x.com", undefined, { TikTok: "shop_tt", Facebook: "" }));
    fireConnect();
    const joins = sock().emit.mock.calls.filter((c) => c[0] === "join_live_room");
    const selects = sock().emit.mock.calls.filter((c) => c[0] === "select_account");
    expect(joins.length).toBeGreaterThanOrEqual(1);
    expect(selects.length).toBeGreaterThanOrEqual(2); // both platforms re-asserted
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

  it("the manual connect() path is unchanged: POST + optimistic account", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => {
      const r = await result.current.connect("TikTok", { username: "shop_tt" });
      expect(r.ok).toBe(true);
    });
    expect(connectPlatformMock).toHaveBeenCalledTimes(1);
    expect(result.current.activeAccounts.TikTok).toBe("shop_tt");
  });
});
