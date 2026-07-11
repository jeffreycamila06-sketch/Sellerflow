// STATUS-TRUTH — the green pill is a promise: "I am capturing your orders right
// now." This suite pins the Definition of Done:
//   #2 green stays green while connected — a SUCCESSFUL server health-cycle
//      reconnect is invisible (zero flapping);
//   #3 green is never a zombie — a dead socket or an unrecovered reconnect falls
//      to an honest gray;
//   #4 terminal states (streamEnd / not_live / manual) gray IMMEDIATELY;
//   delivery regression guard: comments keep flowing during the reconnect grace.
// Socket stub mirrors useLiveFeed.autoreconnect.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));

import { useLiveFeed, RECONNECT_GRACE_MS, SOCKET_GRACE_MS } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });
const green = { platform: "TikTok", connected: true, username: "shop_tt" };
const reconnecting = { platform: "TikTok", connected: false, reconnecting: true, username: "shop_tt" };
const terminal = { platform: "TikTok", connected: false, reconnecting: false, username: "shop_tt" };

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); vi.useFakeTimers(); connectPlatformMock.mockResolvedValue({ ok: true, account: "shop_tt" }); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const setup = () => renderHook(() => useLiveFeed(true, "g@x.com"));

describe("status truth — green ⇔ stream health", () => {
  it("connected status → green with the account (DoD #2 baseline)", () => {
    const { result } = setup();
    fire("platform_status", green);
    expect(result.current.ttConnected).toBe(true);
    expect(result.current.activeAccounts.TikTok).toBe("shop_tt");
  });

  it("ZERO FLAP: health-cycle reconnect that recovers within grace never drops green", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("platform_status", reconnecting);                       // server health cycle starts
    expect(result.current.ttConnected).toBe(true);               // still green (grace)
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS - 5000));
    expect(result.current.ttConnected).toBe(true);               // still green just before deadline
    fire("platform_status", green);                              // reconnect SUCCEEDED
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2));   // old timer must be cancelled
    expect(result.current.ttConnected).toBe(true);               // never flapped
    expect(result.current.activeAccounts.TikTok).toBe("shop_tt");
  });

  it("HONEST GRAY: reconnect that never recovers falls gray after the grace", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("platform_status", reconnecting);
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000));
    expect(result.current.ttConnected).toBe(false);              // promise withdrawn honestly
    expect(result.current.activeAccounts.TikTok).toBe("");
  });

  it("repeated reconnecting events do NOT extend the grace (earliest deadline wins)", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("platform_status", reconnecting);
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000));
    fire("platform_status", reconnecting);                       // retry announcement near deadline
    act(() => vi.advanceTimersByTime(2000));                     // original deadline passes
    expect(result.current.ttConnected).toBe(false);              // gray at the ORIGINAL deadline
  });

  it("terminal not-connected (streamEnd/not_live/manual) grays IMMEDIATELY (DoD #4)", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("platform_status", terminal);
    expect(result.current.ttConnected).toBe(false);
    expect(result.current.activeAccounts.TikTok).toBe("");
  });

  it("reconnecting while ALREADY gray never turns green (no optimistic green)", () => {
    const { result } = setup();
    fire("platform_status", reconnecting);
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2));
    expect(result.current.ttConnected).toBe(false);
  });

  // F2 (audit) — connected:true + reconnecting:true landing in the SAME batch
  // (fresh connection dying at birth): the old currently-green gate read a
  // render-mirrored ref that was still stale-false here, silently SKIPPING the
  // grace arm → the pill stayed green indefinitely until the next retry cycle.
  // With the gate removed the grace always arms.
  it("F2 RACE: same-batch connected→reconnecting still arms the grace → honest gray at deadline", () => {
    const { result } = setup();
    act(() => { handlerFor("platform_status")?.(green); handlerFor("platform_status")?.(reconnecting); });
    expect(result.current.ttConnected).toBe(true);               // green, grace armed
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000));
    expect(result.current.ttConnected).toBe(false);              // race no longer skips the arm
  });

  it("F2 RACE + recovery: same-batch sequence that then recovers stays green (no flap)", () => {
    const { result } = setup();
    act(() => { handlerFor("platform_status")?.(green); handlerFor("platform_status")?.(reconnecting); });
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS - 5000));
    fire("platform_status", green);                              // reconnect succeeded in time
    act(() => vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2));
    expect(result.current.ttConnected).toBe(true);
  });

  it("DEAD SOCKET: green must not outlive the socket (zombie fix, DoD #3)", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("disconnect");                                          // socket died
    expect(result.current.ttConnected).toBe(true);               // short grace (blip tolerance)
    act(() => vi.advanceTimersByTime(SOCKET_GRACE_MS + 1000));
    expect(result.current.ttConnected).toBe(false);              // honest gray — no comments can flow
  });

  it("transport BLIP: quick recovery + server snapshot within grace → no flap", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("disconnect");
    act(() => vi.advanceTimersByTime(2000));                     // blip
    fire("connect");                                             // socket back
    fire("platform_status", green);                              // join_live_room snapshot re-asserts
    act(() => vi.advanceTimersByTime(SOCKET_GRACE_MS * 2));
    expect(result.current.ttConnected).toBe(true);               // never went gray
  });

  it("connect_error loop (e.g. stale-token window) → gray after grace, not stale green", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("connect_error");
    fire("connect_error");                                       // repeats must not extend
    act(() => vi.advanceTimersByTime(SOCKET_GRACE_MS + 1000));
    expect(result.current.ttConnected).toBe(false);
  });

  it("DELIVERY REGRESSION GUARD: comments keep flowing during the reconnect grace", () => {
    const { result } = setup();
    fire("platform_status", green);
    fire("platform_status", reconnecting);                       // grace armed, still green
    fire("comment", { handle: "buyer1", name: "Buyer", comment: "mine!", platform: "TikTok", timestamp: new Date().toISOString() });
    expect(result.current.comments.length).toBe(1);              // delivery path untouched
    expect(result.current.comments[0].text).toBe("mine!");
  });

  it("Facebook parity: socket death also clears a green FB pill", () => {
    const { result } = setup();
    fire("platform_status", { platform: "Facebook", connected: true, username: "fbpage" });
    fire("disconnect");
    act(() => vi.advanceTimersByTime(SOCKET_GRACE_MS + 1000));
    expect(result.current.fbConnected).toBe(false);
  });
});
