// Live viewer count (FLive parity) — data-layer contract for the server's
// `platform_viewers` relay (roomUser → viewerCount). Pins:
//   • account scoping: only the TRACKED account's events update the count
//     (trackedAcctRef — the connect-truth intent, set synchronously at tap);
//   • ⚠️ Jeff's required reset test: an account SWITCH clears the count
//     SYNCHRONOUSLY at connect INITIATION — the old account's stale count is
//     never visible for even one frame, without waiting for the new account's
//     first event;
//   • honest gray (terminal / session end) → null; fresh subscription → null;
//   • a REAL 0 is data (shown), invalid payloads are ignored;
//   • READ-ONLY adjacency: platform_viewers events can never move the status
//     machine (connected/recovering) — the sacred-zone pin.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed } from "../useLiveFeed";

const handlerFor = (event: string) => H.sockets[0].on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });
const green = (username: string) => ({ platform: "TikTok", connected: true, reconnecting: false, username });
const viewersEvt = (username: string, count: unknown) => ({ platform: "TikTok", username, count });

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_a" }); });

const connectTo = async (result: { current: ReturnType<typeof useLiveFeed> }, username: string) =>
  act(async () => { await result.current.connect("TikTok", { username }); });

describe("platform_viewers — account-scoped count", () => {
  it("tracked account's event sets the count; a REAL 0 is data (not hidden)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_status", green("shop_a"));
    fire("platform_viewers", viewersEvt("shop_a", 152));
    expect(result.current.ttViewers).toBe(152);
    fire("platform_viewers", viewersEvt("shop_a", 0));
    expect(result.current.ttViewers).toBe(0); // genuine zero = shown, not null
  });

  it("a DIFFERENT account's count is ignored; no tracked account (no tap) drops everything", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_viewers", viewersEvt("shop_a", 99)); // no tap yet → no tracked acct
    expect(result.current.ttViewers).toBe(null);
    await connectTo(result, "shop_a");
    fire("platform_viewers", viewersEvt("shop_b", 500)); // another account's room
    expect(result.current.ttViewers).toBe(null);
    fire("platform_viewers", viewersEvt("shop_a", 41));
    expect(result.current.ttViewers).toBe(41);
  });

  it("invalid payloads are ignored (non-finite / negative / wrong platform)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", viewersEvt("shop_a", "abc"));
    fire("platform_viewers", viewersEvt("shop_a", -5));
    fire("platform_viewers", { platform: "Facebook", username: "shop_a", count: 7 });
    expect(result.current.ttViewers).toBe(null);
  });

  // ⚠️ SERVER-CONTRACT CASING PIN (diff-review blocker): this seam is DORMANT
  // in integration — each side ships with its own fixtures, so a casing
  // mismatch would silently drop every event and surface first in production
  // on deploy morning. The server follows the existing platform_status
  // convention: platform:"TikTok" (emitTikTokStatus, server.js). If the
  // server branch changes that casing, THIS test goes red on the client side.
  it('SERVER CONTRACT: the exact convention payload platform:"TikTok" is accepted', async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", { platform: "TikTok", username: "shop_a", count: 77 }); // verbatim server shape
    expect(result.current.ttViewers).toBe(77);
  });

  it("DEFENSE: casing drift on either side still works (comparison is case-insensitive)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", { platform: "tiktok", username: "shop_a", count: 12 });
    expect(result.current.ttViewers).toBe(12);
  });
});

describe("resets — no stale count, ever", () => {
  it("⚠️ ACCOUNT SWITCH: the count clears SYNCHRONOUSLY at connect INITIATION — before any new-account event", async () => {
    connectPlatformMock.mockResolvedValueOnce({ ok: true, account: "shop_a" });
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", viewersEvt("shop_a", 321));
    expect(result.current.ttViewers).toBe(321);
    connectPlatformMock.mockReturnValueOnce(new Promise(() => {})); // B's POST hangs — inspect mid-flight
    act(() => { void result.current.connect("TikTok", { username: "shop_b" }); });
    expect(result.current.ttViewers).toBe(null); // gone at initiation — zero-frame stale window
  });

  it("terminal gray (not_live/streamEnd class) clears the count", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", viewersEvt("shop_a", 88));
    fire("platform_status", { platform: "TikTok", connected: false, reconnecting: false, username: "shop_a" });
    expect(result.current.ttViewers).toBe(null);
  });

  it("live_session_ended clears the count with the rest of the session", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_viewers", viewersEvt("shop_a", 88));
    fire("live_session_ended", {});
    expect(result.current.ttViewers).toBe(null);
  });
});

describe("READ-ONLY adjacency — the status machine is untouchable from here", () => {
  it("platform_viewers events never change connected/recovering state", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectTo(result, "shop_a");
    fire("platform_status", green("shop_a"));
    expect(result.current.ttConnected).toBe(true);
    fire("platform_viewers", viewersEvt("shop_a", 10));
    fire("platform_viewers", viewersEvt("shop_b", 10)); // even a foreign-account event
    expect(result.current.ttConnected).toBe(true);      // green untouched
    expect(result.current.ttRecovering).toBe(false);    // no doubt introduced
  });
});
