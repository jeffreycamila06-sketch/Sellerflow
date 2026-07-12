// CONNECT-TRUTH Item A (audit condition) — the "Connected!" toast is
// ATTEMPT-GATED: it fires only when a ttConnected RISE lands within the
// window after an actual Connect tap. The audit's exact requirement:
// a rise WITHOUT a tap (health-cycle reconnect success, join snapshot after
// a socket blip) must NEVER toast — no surprise "Connected!" mid-live.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectToastGate, CONNECT_TOAST_WINDOW_MS } from "../connectToastGate";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const setup = (onFire: () => void) => renderHook(
  ({ connected }: { connected: boolean }) => useConnectToastGate(connected, onFire),
  { initialProps: { connected: false } },
);

describe("attempt gate — the audit's test", () => {
  it("BACKGROUND rise (no tap): health-cycle/snapshot re-green → ZERO toast", () => {
    const onFire = vi.fn();
    const { rerender } = setup(onFire);
    rerender({ connected: true });                 // spontaneous rise, seller mid-live
    expect(onFire).not.toHaveBeenCalled();
    rerender({ connected: false });                // blip…
    rerender({ connected: true });                 // …and snapshot re-green
    expect(onFire).not.toHaveBeenCalled();         // still silent — no tap, no toast
  });

  it("tap (arm) + rise within the window → fires EXACTLY once; the next background rise stays silent", () => {
    const onFire = vi.fn();
    const { result, rerender } = setup(onFire);
    act(() => result.current.arm());               // the Connect tap
    rerender({ connected: true });                 // server confirms
    expect(onFire).toHaveBeenCalledTimes(1);
    rerender({ connected: false });
    rerender({ connected: true });                 // later background recovery
    expect(onFire).toHaveBeenCalledTimes(1);       // arm was consumed — no re-toast
  });

  it("an abandoned attempt never toasts later: rise AFTER the window → silent", () => {
    const onFire = vi.fn();
    const { result, rerender } = setup(onFire);
    act(() => result.current.arm());
    act(() => { vi.advanceTimersByTime(CONNECT_TOAST_WINDOW_MS + 1000); });
    rerender({ connected: true });                 // stale intent
    expect(onFire).not.toHaveBeenCalled();
  });

  it("failed attempt disarms: a background rise after a failed connect can't claim the stale tap", () => {
    const onFire = vi.fn();
    const { result, rerender } = setup(onFire);
    act(() => result.current.arm());               // tap…
    act(() => result.current.disarm());            // …POST failed (not-live / unreachable)
    rerender({ connected: true });                 // old account's background re-assert
    expect(onFire).not.toHaveBeenCalled();
  });

  it("a re-assert at the same value (connected stays true) is not a rise — never fires", () => {
    const onFire = vi.fn();
    const { result, rerender } = setup(onFire);
    act(() => result.current.arm());
    rerender({ connected: true });                 // rise → fires
    expect(onFire).toHaveBeenCalledTimes(1);
    act(() => result.current.arm());               // another tap while already green…
    rerender({ connected: true });                 // …same value re-render: no edge
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
