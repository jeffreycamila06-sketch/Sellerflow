// Shopee status like TikTok / Facebook (2026-11-22):
//   a. socket loss → the Shopee pill grays after SOCKET_GRACE_MS, unless the server's status comes back first;
//   b. a stop the server explains (platform_status Shopee connected:false + reason) is kept as shopeeLastStop.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

import { useLiveFeed, SOCKET_GRACE_MS } from "../useLiveFeed";

const fire = (event: string, d?: unknown) => act(() => {
  for (const c of H.sockets[0].on.mock.calls) if (c[0] === event) (c[1] as (x?: unknown) => void)(d);
});
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const green = { platform: "Shopee", connected: true, username: "777" };

beforeEach(() => { vi.useFakeTimers(); H.sockets.length = 0; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("a — socket loss grace for Shopee", () => {
  it("socket drops → still green inside the grace, gray after it", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    expect(result.current.shopeeConnected).toBe(true);
    fire("disconnect");
    wait(SOCKET_GRACE_MS - 1);
    expect(result.current.shopeeConnected).toBe(true);
    wait(1);
    expect(result.current.shopeeConnected).toBe(false);
    expect(result.current.activeAccounts.Shopee).toBe("");
    expect(result.current.shopeeLastStop).toBeNull();           // a socket blip is not a stop with a reason
  });
  it("socket back and the server replays green inside the grace → never grays", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    fire("disconnect");
    wait(SOCKET_GRACE_MS / 2);
    fire("connect");
    fire("platform_status", green);                             // the server's join replay
    wait(SOCKET_GRACE_MS * 3);
    expect(result.current.shopeeConnected).toBe(true);
  });
  it("connect_error counts the same; repeated drops keep the FIRST deadline", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    fire("connect_error");
    wait(SOCKET_GRACE_MS - 1000);
    fire("disconnect");                                         // does not push the deadline later
    wait(1000);
    expect(result.current.shopeeConnected).toBe(false);
  });
  it("Shopee already gray → a socket drop does nothing", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("disconnect");
    wait(SOCKET_GRACE_MS * 2);
    expect(result.current.shopeeConnected).toBe(false);
    fire("platform_status", green);                             // a later green is not undone by an old timer
    wait(SOCKET_GRACE_MS * 2);
    expect(result.current.shopeeConnected).toBe(true);
  });
  it("the server's own gray inside the grace wins at once; the session end clears the timer", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    fire("disconnect");
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason: "session_end" });
    expect(result.current.shopeeConnected).toBe(false);
    fire("platform_status", green);
    fire("disconnect");
    fire("live_session_ended", {});
    fire("platform_status", green);                             // green again after the end
    wait(SOCKET_GRACE_MS * 2);
    expect(result.current.shopeeConnected).toBe(true);          // the old socket-loss timer was cleared
  });
  it("TikTok / Facebook are not touched by the Shopee grace", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    fire("disconnect");
    wait(SOCKET_GRACE_MS + 10);
    expect(result.current.ttConnected).toBe(false);
    expect(result.current.fbConnected).toBe(false);
    expect(result.current.ttRecovering).toBe(false);
    expect(result.current.fbRecovering).toBe(false);
  });
});

describe("b — the stop reason", () => {
  it.each(["session_end", "unreachable", "restart", "shutdown", "max_session", "something_new"])("reason %s is kept", (reason) => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", green);
    vi.setSystemTime(new Date("2026-11-22T05:30:00Z"));
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason });
    expect(result.current.shopeeLastStop).toEqual({ reason, at: Date.parse("2026-11-22T05:30:00Z") });
  });
  it("a gray with no reason keeps the previous stop; a new stop replaces it", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason: "unreachable" });
    fire("platform_status", { platform: "Shopee", connected: false, username: "777" });
    expect(result.current.shopeeLastStop?.reason).toBe("unreachable");
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason: "shutdown" });
    expect(result.current.shopeeLastStop?.reason).toBe("shutdown");
  });
  it("another device's stop (other session id) never reaches this device", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason: "restart", sessionId: "someone-else" });
    expect(result.current.shopeeLastStop).toBeNull();
  });
  it("a different signed-in seller starts with no stop line", () => {
    const { result, rerender } = renderHook(({ e }) => useLiveFeed(true, e), { initialProps: { e: "g@x.com" } });
    fire("platform_status", { platform: "Shopee", connected: false, username: "777", reason: "session_end" });
    expect(result.current.shopeeLastStop).not.toBeNull();
    rerender({ e: "other@x.com" });
    expect(result.current.shopeeLastStop).toBeNull();
  });
});
