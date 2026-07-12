// CONNECT-TRUTH (post-revert redesign of the off-latch fix; audited plan) —
// the pill's green may come ONLY from a platform_status connected:true whose
// username matches the Connect tap's intent. The POST result (r.ok) says "the
// server accepted the request", NOT "the new account is live and this client
// is receiving" — the reuse/fail-open 200s proved it (Jeff's zombie-green
// regression, check #3). This suite pins:
//   • THE REGRESSION (first): r.ok=true + NO status event → pill GRAY;
//   • initiation honest-false: a user tap voids the old platform state
//     (green, recovering amber, pending gray timers) synchronously;
//   • INTENT GUARD: a spontaneous connected:true for a DIFFERENT account
//     (old account's health-cycle success / join snapshot after a blip)
//     never re-greens the pill under the new intent — the audit's real find;
//   • events without a username still apply (backward compat, H1 mirror);
//   • 409 not-live stays gray; the new account's own events apply mid-dance
//     (intent is set at INITIATION, not r.ok — H1-safe, synchronous);
//   • activeAccounts is now purely server-driven (zero prod consumers,
//     grep+spread+prop-pass verified; kept as the server-truth observable).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed, RECONNECT_GRACE_MS } from "../useLiveFeed";

const handlerFor = (event: string) => H.sockets[0].on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });
const greenFor = (username?: string) => ({ platform: "TikTok", connected: true, reconnecting: false, ...(username !== undefined ? { username } : {}) });

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_b" }); });
afterEach(() => { vi.useRealTimers(); });

const connectB = async (result: { current: ReturnType<typeof useLiveFeed> }) =>
  act(async () => { await result.current.connect("TikTok", { username: "shop_b" }); });

describe("⚠️ THE REGRESSION PIN — r.ok is not truth", () => {
  it("connect resolves ok:true but NO status event ever arrives → pill stays GRAY (Jeff's check #3 class)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectB(result);
    expect(result.current.ttConnected).toBe(false);        // no server assertion → no green
    expect(result.current.activeAccounts.TikTok).toBe(""); // no optimistic account either
  });

  it("green arrives ONLY via the matching status event (usually emitted before the response)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectB(result);
    fire("platform_status", greenFor("shop_b"));
    expect(result.current.ttConnected).toBe(true);
    expect(result.current.activeAccounts.TikTok).toBe("shop_b"); // server-driven
  });
});

describe("initiation honest-false — a tap voids the old platform state", () => {
  it("green on A → connect(B) initiation drops green SYNCHRONOUSLY (no stale-A green during the dance)", async () => {
    connectPlatformMock.mockReturnValueOnce(new Promise(() => {})); // POST hangs — inspect mid-flight
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", greenFor("shop_a"));
    expect(result.current.ttConnected).toBe(true);
    act(() => { void result.current.connect("TikTok", { username: "shop_b" }); });
    expect(result.current.ttConnected).toBe(false);        // honest-false at initiation, before any response
  });

  it("recovering (F3 amber) + pending gray timer are cleared at initiation — no stale amber, no ghost gray flip", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", greenFor("shop_a"));
    fire("platform_status", { platform: "TikTok", connected: false, reconnecting: true, username: "shop_a" });
    expect(result.current.ttRecovering).toBe(true);        // grace armed for A
    await connectB(result);
    expect(result.current.ttRecovering).toBe(false);       // initiation voided the doubt
    fire("platform_status", greenFor("shop_b"));           // B confirms
    act(() => { vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2); });
    expect(result.current.ttConnected).toBe(true);         // A's old timer can never gray B
    vi.runOnlyPendingTimers();
  });
});

describe("INTENT GUARD — the audit's find: no green from another account after the tap", () => {
  it("old account A's spontaneous connected:true (health-cycle success / join snapshot) is IGNORED while intent=B", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", greenFor("shop_a"));           // green on A first
    await connectB(result);                                // user intends B now
    fire("platform_status", greenFor("shop_a"));           // A's background re-assert
    expect(result.current.ttConnected).toBe(false);        // NOT re-greened under B's name
    expect(result.current.activeAccounts.TikTok).toBe(""); // and no account drift
    fire("platform_status", greenFor("shop_b"));           // B's own assertion
    expect(result.current.ttConnected).toBe(true);         // green for the intended account only
  });

  it("connected events WITHOUT a username still apply (backward compat, H1 mirror)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectB(result);
    fire("platform_status", greenFor(undefined));
    expect(result.current.ttConnected).toBe(true);
  });

  it("no intent yet (no tap this page session) → any connected event applies (fresh-status path unchanged)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fire("platform_status", greenFor("shop_a"));
    expect(result.current.ttConnected).toBe(true);
  });
});

describe("failure + own-account events during the dance", () => {
  it("409 not-live → stays gray (notLive passthrough intact)", async () => {
    connectPlatformMock.mockResolvedValue({ ok: false, notLive: true, error: "Account is not live right now.", account: "" });
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    let r: { ok: boolean; notLive?: boolean } | undefined;
    await act(async () => { r = await result.current.connect("TikTok", { username: "shop_b" }); });
    expect(r).toMatchObject({ ok: false, notLive: true });
    expect(result.current.ttConnected).toBe(false);
  });

  it("intent set at INITIATION (not r.ok): B's own terminal event mid-POST APPLIES (H1 window closed)", async () => {
    let resolveConnect!: (v: { ok: boolean; account: string }) => void;
    connectPlatformMock.mockReturnValueOnce(new Promise((res) => { resolveConnect = res; }));
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.connect("TikTok", { username: "shop_b" }); });
    fire("platform_status", greenFor("shop_b"));           // B's connected emit lands mid-POST (real server order)
    expect(result.current.ttConnected).toBe(true);         // intent already B → applies
    await act(async () => { resolveConnect({ ok: true, account: "shop_b" }); await pending; });
    expect(result.current.ttConnected).toBe(true);
  });

  it("A's stale reconnecting chain is ignored the moment the tap lands (tracked=B at initiation)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await connectB(result);
    fire("platform_status", { platform: "TikTok", connected: false, reconnecting: true, username: "shop_a" });
    expect(result.current.ttRecovering).toBe(false);       // H1 with the new intent: A can't amber B's dance
    fire("platform_status", greenFor("shop_b"));
    act(() => { vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2); });
    expect(result.current.ttConnected).toBe(true);
    vi.runOnlyPendingTimers();
  });
});
