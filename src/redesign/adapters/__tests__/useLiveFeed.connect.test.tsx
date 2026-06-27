// Integration: useLiveFeed.connect state machine + socket cleanup (readiness review
// gap #2). Real socket is APK-only, so the socket.io client + connectPlatform POST
// are mocked at the boundary — we test the hook's success/failure state + that the
// socket is disconnected on unmount (no leak). Asserts CURRENT correct behavior.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mutable socket stub (fresh per render via the factory).
const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

// connectPlatform = the POST to Render. Keep the rest of connect.ts real (commentKey
// keying, cleanLiveAccount, etc.).
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed } from "../useLiveFeed";

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

describe("useLiveFeed.connect — state machine + cleanup", () => {
  it("success → ok + active account set for the platform", async () => {
    connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_tt" });
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    let r: { ok: boolean; account: string } | undefined;
    await act(async () => { r = await result.current.connect("TikTok", { username: "shop_tt" }); });
    expect(r).toMatchObject({ ok: true, account: "shop_tt" });
    expect(result.current.activeAccounts.TikTok).toBe("shop_tt");
    expect(connectPlatformMock).toHaveBeenCalledWith("TikTok", { username: "shop_tt" }, "g@x.com");
  });

  it("failure → ok:false + real error passed through; no active account set", async () => {
    connectPlatformMock.mockResolvedValue({ ok: false, error: "Can't reach the live server. Check your connection.", account: "shop_tt" });
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.connect("TikTok", { username: "shop_tt" }); });
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(/Can't reach the live server/);
    expect(result.current.activeAccounts.TikTok).toBe(""); // unchanged on failure
  });

  it("not signed in (no email) → ok:false 'Not signed in'; connectPlatform NOT called", async () => {
    const { result } = renderHook(() => useLiveFeed(true, undefined));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.connect("TikTok", { username: "x" }); });
    expect(r).toMatchObject({ ok: false, error: "Not signed in" });
    expect(connectPlatformMock).not.toHaveBeenCalled();
  });

  it("cleanup on unmount disconnects the socket (no leak / no setState-after-unmount)", () => {
    const { unmount } = renderHook(() => useLiveFeed(true, "g@x.com"));
    expect(H.sockets.length).toBe(1);
    expect(H.sockets[0].disconnect).not.toHaveBeenCalled();
    unmount();
    expect(H.sockets[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
