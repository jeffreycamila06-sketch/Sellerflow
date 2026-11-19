// Test helper (not a test): what the END OF A TEST FILE looks like to a timer nobody stopped.
// The test runner removes the page; a timer that then sets React state throws
// "ReferenceError: window is not defined" — the unhandled error of CI run 1843.
//
// Use with vi.useFakeTimers() — the test clock moves ONLY when the test moves it (tick), so a slow
// machine changes nothing. That also means the testing library's own waits (findBy…, waitFor) never
// finish here: wait with until(…) instead.
//   await until(() => r.queryByTestId("toast"));   // the screen's awaits finish; the clock stands still
//   r.unmount();                                    // the screen closes
//   expectNothingLate();                            // no timer of it is left, and with the page gone nothing updates
import { expect, vi } from "vitest";
import { act } from "@testing-library/react";

/** Runs fn with the page removed, then puts the page back. */
export function withThePageGone(fn: () => void) {
  const d = Object.getOwnPropertyDescriptor(globalThis, "window");
  expect(Reflect.deleteProperty(globalThis, "window")).toBe(true);
  try {
    expect(typeof window).toBe("undefined"); // the detector is really armed
    fn();
  } finally {
    if (d) Object.defineProperty(globalThis, "window", d);
  }
}

/** What is left after the screen closed: how many timers, and the error (if any) when the clock
 *  runs a minute on with the page gone. Both are read before either is judged. */
export function afterClose(): { timersLeft: number; lateUpdate: string | null } {
  const timersLeft = vi.getTimerCount();
  let lateUpdate: string | null = null;
  withThePageGone(() => {
    try { vi.advanceTimersByTime(60_000); } catch (e) { lateUpdate = String((e as Error).message); }
  });
  return { timersLeft, lateUpdate };
}

/** After the screen closed: nothing of it is on the clock, and nothing updates late. */
export function expectNothingLate() {
  expect(afterClose()).toEqual({ timersLeft: 0, lateUpdate: null });
  expect(vi.getTimerCount()).toBe(0);
}

/** Let the awaits inside a tap finish (the fake clock is not moved). */
export const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
/** Move the fake clock. */
export const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** Wait until `seen()` gives something (not null / false / "") — WITHOUT moving the clock: each turn only
 *  lets the screen's awaits go on. A check that throws counts as "not yet". Give stepMs only for a wait
 *  that sits on a timer of the screen (a typing pause): the clock then moves stepMs per turn. */
export async function until(seen: () => unknown, stepMs = 0, turns = 500): Promise<void> {
  const ok = () => { try { const v = seen(); return v !== null && v !== undefined && v !== false && v !== ""; } catch { return false; } };
  for (let i = 0; i < turns && !ok(); i++) await tick(stepMs);
  expect(ok(), "what the test waited for never came").toBe(true);
}
