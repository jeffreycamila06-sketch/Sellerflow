// useScreenTimers — a screen's short timers (toasts, "Copied" notes, a button's short rest).
// While the screen is open: exactly setTimeout. When it closes: every waiting timer is stopped,
// and nothing new starts afterwards.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode, useEffect, useState } from "react";
import { render, fireEvent, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useScreenTimers, type Later } from "../useScreenTimers";
import { afterClose, expectNothingLate, tick, withThePageGone } from "./pageGone";

let laterOut: Later | null = null;
function Screen({ ms = 2500 }: { ms?: number }) {
  const [toast, setToast] = useState("");
  const [n, setN] = useState(0);
  const later = useScreenTimers();
  useEffect(() => { laterOut = later; });   // handed to the tests after every render
  return (
    <div>
      <button data-testid="save" onClick={() => { setToast("Saved"); later(() => setToast(""), ms); }}>save</button>
      <button data-testid="other" onClick={() => { setToast("Copied"); later(() => setToast(""), 1000); }}>copy</button>
      <button data-testid="re" onClick={() => setN((x) => x + 1)}>{n}</button>
      <div data-testid="toast">{toast}</div>
    </div>
  );
}
const toast = (r: ReturnType<typeof render>) => r.getByTestId("toast").textContent;

beforeEach(() => { vi.useFakeTimers(); laterOut = null; });   // the clock moves only when a test moves it
afterEach(() => { vi.useRealTimers(); });

describe("the detector (so the checks below cannot pass by accident)", () => {
  it("the OLD pattern — a timer that sets state and is never stopped — leaves 1 timer and throws the CI error", () => {
    function Old() {
      const [x, setX] = useState("");
      return <button data-testid="old" onClick={() => { setX("shown"); setTimeout(() => setX(""), 2500); }}>{x}</button>;
    }
    const r = render(<Old />);
    fireEvent.click(r.getByTestId("old"));
    r.unmount();
    expect(afterClose()).toEqual({ timersLeft: 1, lateUpdate: "window is not defined" });
  });
});

describe("while the screen is open it is exactly setTimeout", () => {
  it("the toast hides after its own time — not earlier, not later", async () => {
    const r = render(<Screen />);
    fireEvent.click(r.getByTestId("save"));
    expect(toast(r)).toBe("Saved");
    await tick(2499);
    expect(toast(r)).toBe("Saved");
    await tick(1);
    expect(toast(r)).toBe("");
    expect(vi.getTimerCount()).toBe(0);   // a timer that fired is forgotten
  });
  it("nothing is stopped early: an older toast's timer still hides a newer toast (as before)", async () => {
    const r = render(<Screen />);
    fireEvent.click(r.getByTestId("save"));      // hides at 2.5 s
    await tick(2000);
    fireEvent.click(r.getByTestId("other"));     // "Copied", its own timer hides at 3.0 s
    expect(toast(r)).toBe("Copied");
    expect(vi.getTimerCount()).toBe(2);
    await tick(500);                             // 2.5 s: the FIRST timer fires and hides the newer toast
    expect(toast(r)).toBe("");
    expect(vi.getTimerCount()).toBe(1);
    await tick(500);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a re-render keeps the timers and the same function", async () => {
    const r = render(<Screen />);
    const first = laterOut;
    fireEvent.click(r.getByTestId("save"));
    fireEvent.click(r.getByTestId("re"));
    fireEvent.click(r.getByTestId("re"));
    expect(laterOut).toBe(first);
    expect(vi.getTimerCount()).toBe(1);
    await tick(2500);
    expect(toast(r)).toBe("");
  });
  it("the callback runs once, with the delay asked for", async () => {
    const r = render(<Screen />);
    const fn = vi.fn();
    act(() => { laterOut!(fn, 700); });
    await tick(699);
    expect(fn).not.toHaveBeenCalled();
    await tick(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await tick(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

describe("when the screen closes", () => {
  it("every waiting timer is stopped: nothing is left, nothing updates late", () => {
    const r = render(<Screen />);
    fireEvent.click(r.getByTestId("save"));
    fireEvent.click(r.getByTestId("other"));
    expect(vi.getTimerCount()).toBe(2);
    r.unmount();
    expectNothingLate();
  });
  it("only the timers still waiting are stopped: one that already fired is forgotten", async () => {
    const r = render(<Screen />);
    fireEvent.click(r.getByTestId("other"));     // 1 s — fires below
    await tick(1000);
    fireEvent.click(r.getByTestId("save"));      // 2.5 s — still waiting at the close
    const stop = vi.spyOn(globalThis, "clearTimeout");
    r.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    stop.mockRestore();
    expectNothingLate();
  });
  it("a stopped timer's callback never runs", async () => {
    const r = render(<Screen />);
    const fn = vi.fn();
    act(() => { laterOut!(fn, 500); });
    r.unmount();
    await tick(60_000);
    expect(fn).not.toHaveBeenCalled();
  });
  it("after the close nothing new is started (an answer that arrives late starts no timer)", async () => {
    const r = render(<Screen />);
    const later = laterOut!;
    r.unmount();
    const fn = vi.fn();
    later(fn, 100);
    expect(vi.getTimerCount()).toBe(0);
    withThePageGone(() => { vi.advanceTimersByTime(60_000); });
    expect(fn).not.toHaveBeenCalled();
  });
  it("two screens: closing one leaves the other's timers alone", async () => {
    const a = render(<Screen />);
    const b = render(<Screen />);
    const inB = within(b.container);
    fireEvent.click(within(a.container).getByTestId("save"));
    fireEvent.click(inB.getByTestId("save"));
    a.unmount();
    expect(vi.getTimerCount()).toBe(1);
    expect(inB.getByTestId("toast").textContent).toBe("Saved");
    await tick(2500);
    expect(inB.getByTestId("toast").textContent).toBe("");
    b.unmount();
    expectNothingLate();
  });
  it("React's strict mode (effects run, stop, run again): the screen still counts as open", async () => {
    const r = render(<StrictMode><Screen /></StrictMode>);
    fireEvent.click(r.getByTestId("save"));
    expect(toast(r)).toBe("Saved");
    expect(vi.getTimerCount()).toBe(1);
    await tick(2500);
    expect(toast(r)).toBe("");
    fireEvent.click(r.getByTestId("save"));
    r.unmount();
    expectNothingLate();
  });
});

describe("the screens that use it", () => {
  const SCREENS = [
    "src/redesign/components/InviteFriendsCard.tsx",
    "src/redesign/screens/InviteFriends.tsx",
    "src/redesign/screens/CustomerDetails.tsx",
    "src/redesign/screens/FmCustomerDetails.tsx",
    "src/redesign/screens/ParcelScan.tsx",
    "src/redesign/screens/Products.tsx",
    "src/redesign/screens/Orders.tsx",
  ];
  // comments are not code
  const codeOf = (f: string) => readFileSync(f, "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  it("none of them starts a bare timer that sets state any more", () => {
    for (const f of SCREENS) {
      const code = codeOf(f);
      expect(code, f).toContain("useScreenTimers()");
      const bare = code.split("\n").filter((l) => /(^|[^A-Za-z.])(window\.)?setTimeout\(\s*(\(\)\s*=>\s*set[A-Z]|onSaved\b|bumpQuota\b)/.test(l) && !/(const|let)\s+\w+\s*=|\.current\s*=/.test(l));
      expect(bare, f).toEqual([]);
    }
  });
  it("the number of timers moved to it, per file (16 in all, + 1 for the Scan QR '2 stickers' toast of 2026-11-20, + 3 for the native scanner of 2026-11-22: ParcelScan 2 toasts, Orders 1 scan message, + 2 for the in-page scanner of 2026-11-25: ParcelScan 2 toasts, + 1 for Cancel order of 2026-11-28: the Orders 'cancelled / back' toast)", () => {
    const count = (f: string) => (codeOf(f).match(/\blater\(/g) || []).length;
    expect(SCREENS.map(count)).toEqual([2, 4, 1, 1, 10, 1, 4]);
  });
});
