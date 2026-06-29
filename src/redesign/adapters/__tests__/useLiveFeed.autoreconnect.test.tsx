// Fix B — auto-reconnect after a socket drop / server restart. Verifies: tracks
// genuinely-connected accounts, SKIPS the first socket connect (no re-POST), re-POSTs
// /connect on a RE-connect after a 0–60s jitter, dedupes when the server already reports
// the account live, and forgets accounts the user manually disconnected. TikTok + Facebook.
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

import { useLiveFeed } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fireConnect = () => act(() => { handlerFor("connect")?.(); });
const firePlatformStatus = (d: unknown) => act(() => { handlerFor("platform_status")?.(d); });
const rePostCalls = (platform: string) => connectPlatformMock.mock.calls.filter((c) => c[0] === platform);

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); vi.useFakeTimers(); connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_tt" }); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("useLiveFeed Fix B — auto-reconnect after restart", () => {
  it("FIRST socket connect does NOT re-POST (nothing was connected yet)", () => {
    renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();                         // first connect
    act(() => vi.advanceTimersByTime(25000));
    expect(connectPlatformMock).not.toHaveBeenCalled();
  });

  it("RE-connect re-POSTs /connect for a tracked account after jitter", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();                         // first connect (sets the flag)
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); }); // genuine connect → tracked
    connectPlatformMock.mockClear();
    fireConnect();                         // RE-connect (socket dropped/restart)
    expect(rePostCalls("TikTok").length).toBe(0); // still waiting on jitter
    act(() => vi.advanceTimersByTime(25000));      // jitter elapses
    expect(rePostCalls("TikTok").length).toBe(1);
    expect(connectPlatformMock).toHaveBeenCalledWith("TikTok", { username: "shop_tt" }, "g@x.com");
  });

  it("does NOT re-POST an account the user manually disconnected", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); });
    act(() => { result.current.markDisconnected("TikTok"); }); // user turned it off
    connectPlatformMock.mockClear();
    fireConnect();                         // reconnect
    act(() => vi.advanceTimersByTime(25000));
    expect(rePostCalls("TikTok").length).toBe(0);
  });

  it("dedupe: skips re-POST if the server already reports the account live", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => { await result.current.connect("TikTok", { username: "shop_tt" }); });
    firePlatformStatus({ platform: "TikTok", connected: true, username: "shop_tt" }); // server still has it
    connectPlatformMock.mockClear();
    fireConnect();                         // reconnect
    act(() => vi.advanceTimersByTime(25000));
    expect(rePostCalls("TikTok").length).toBe(0);
  });

  it("Facebook parity: re-POSTs a tracked FB account on reconnect", async () => {
    connectPlatformMock.mockResolvedValue({ ok: true, account: "fbpage" });
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireConnect();
    await act(async () => { await result.current.connect("Facebook", { username: "fbpage" }); });
    connectPlatformMock.mockClear();
    fireConnect();
    act(() => vi.advanceTimersByTime(25000));
    expect(rePostCalls("Facebook").length).toBe(1);
    expect(connectPlatformMock).toHaveBeenCalledWith("Facebook", { username: "fbpage" }, "g@x.com");
  });
});
