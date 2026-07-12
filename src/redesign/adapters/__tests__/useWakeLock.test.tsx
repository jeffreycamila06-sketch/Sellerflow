// KEEP-AWAKE habang naka-live — web Screen Wake Lock contract:
//   • acquire on GREEN · hold on AMBER (connecting/recovering) · release on
//     honest GRAY (the pure shouldHoldWakeLock matrix);
//   • visibilitychange re-acquire, TRIPLE-GUARDED: visible + still holding
//     (the listener only exists while hold=true) + toggle ON (same);
//   • no navigator.wakeLock (iOS <16.4) → graceful no-op, zero crash;
//   • toggle OFF → no lock, and an active lock is RELEASED.
// Client-display-only: no connection-state writes, no delivery path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWakeLock, shouldHoldWakeLock, wakeLockSupported, type WakeLockStates } from "../useWakeLock";

type Sentinel = { release: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
const makeSentinel = (): Sentinel => ({ release: vi.fn(() => Promise.resolve()), addEventListener: vi.fn() });

let sentinels: Sentinel[] = [];
const requestMock = vi.fn(() => { const s = makeSentinel(); sentinels.push(s); return Promise.resolve(s); });
const nav = navigator as Navigator & { wakeLock?: { request: typeof requestMock } };

const flush = () => act(async () => { await Promise.resolve(); });
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
};

beforeEach(() => {
  sentinels = [];
  requestMock.mockClear();
  nav.wakeLock = { request: requestMock };
  setVisibility("visible");
});

const GRAY: WakeLockStates = { ttEff: false, fbEff: false, ttConnecting: false, fbConnecting: false, ttRecovering: false, fbRecovering: false };

describe("shouldHoldWakeLock — the pure hold matrix", () => {
  it("GREEN (either platform) → hold", () => {
    expect(shouldHoldWakeLock(true, { ...GRAY, ttEff: true })).toBe(true);
    expect(shouldHoldWakeLock(true, { ...GRAY, fbEff: true })).toBe(true);
  });
  it("AMBER (connecting or recovering) → hold — sleeping mid-heal kills the recovery", () => {
    expect(shouldHoldWakeLock(true, { ...GRAY, ttConnecting: true })).toBe(true);
    expect(shouldHoldWakeLock(true, { ...GRAY, ttRecovering: true })).toBe(true);
    expect(shouldHoldWakeLock(true, { ...GRAY, fbRecovering: true })).toBe(true);
  });
  it("honest GRAY (both platforms) → release (battery)", () => {
    expect(shouldHoldWakeLock(true, GRAY)).toBe(false);
  });
  it("toggle OFF → never hold, kahit green", () => {
    expect(shouldHoldWakeLock(false, { ...GRAY, ttEff: true, ttRecovering: true })).toBe(false);
  });
});

describe("useWakeLock — lifecycle", () => {
  it("hold=true → requests a screen wake lock; hold→false (honest gray) → releases it", async () => {
    const { rerender } = renderHook(({ hold }) => useWakeLock(hold), { initialProps: { hold: true } });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith("screen");
    rerender({ hold: false });
    await flush();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);          // battery back on gray
  });

  it("visibilitychange re-acquire: OS released the lock while hidden → visible again (still holding) → re-requests", async () => {
    renderHook(() => useWakeLock(true));
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
    // OS auto-release on hide: the sentinel's release event fires
    const releaseCb = sentinels[0].addEventListener.mock.calls.find((c) => c[0] === "release")?.[1] as () => void;
    act(() => { releaseCb(); });                                     // sentinel dead, ref forgotten
    setVisibility("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(2);                    // re-acquired (guard 1: visible ✓)
  });

  it("guarded re-acquire: after hold→false the visibility listener is GONE — a visible event re-requests NOTHING (guards 2+3 structural)", async () => {
    const { rerender } = renderHook(({ hold }) => useWakeLock(hold), { initialProps: { hold: true } });
    await flush();
    rerender({ hold: false });                                       // gray o toggle OFF
    await flush();
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);                    // walang bagong request
  });

  it("hidden page → acquire deferred (no request); becomes visible → acquires", async () => {
    setVisibility("hidden");
    renderHook(() => useWakeLock(true));
    await flush();
    expect(requestMock).not.toHaveBeenCalled();                      // guard 1
    setVisibility("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("no navigator.wakeLock (iOS <16.4) → graceful no-op, zero crash", async () => {
    delete nav.wakeLock;
    expect(wakeLockSupported()).toBe(false);
    const { rerender, unmount } = renderHook(({ hold }) => useWakeLock(hold), { initialProps: { hold: true } });
    await flush();
    rerender({ hold: false });
    unmount();                                                       // buong lifecycle, walang sabog
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("unmount while holding → released (no leaked lock after logout/nav)", async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await flush();
    unmount();
    await flush();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });
});
