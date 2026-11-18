// Pickup Status — the toast timers stop when the screen closes (CI run 1843: all tests passed,
// then "ReferenceError: window is not defined" from the 1.5 s "Copied" timer, which fired after
// the test page was gone and set state on a screen that no longer existed).
//
// What is checked:
//   · close the screen right after a copy / a message copy / a refused check → no timer of the
//     screen is left, and with the page gone the clock can run on without any state update;
//   · an answer that arrives AFTER the screen closed starts no new timer;
//   · while the screen is open nothing changed for the seller: each toast still hides after its
//     own time (1.5 s for a copy, 5 s for a check message), exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow, TrackingStatus } from "../../adapters/parcelTracking";
import type { ContactMaps } from "../../adapters/buyerContactMap";

const { loadParcelTracking, loadTrackingStatus, requestCheck, loadBuyerContacts, copyText } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(), loadTrackingStatus: vi.fn(), requestCheck: vi.fn(),
  loadBuyerContacts: vi.fn(), copyText: vi.fn(),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return {
    ...actual, loadParcelTracking, loadTrackingStatus, requestCheck,
    loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })), loadBuyerNamesByHandle: vi.fn(async () => new Map<string, string>()),
  };
});
vi.mock("../../adapters/buyerContactMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/buyerContactMap")>();
  return { ...actual, loadBuyerContacts };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: (t: string) => copyText(t) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => false }));
vi.mock("../../adapters/platform", () => ({ isIOS: () => false, isAndroid: () => false }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-11-03" }));

import ParcelTracking from "../ParcelTracking";

const row = (id: string, over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id, trackingNo: `F0000${id}`, cmOrderNo: null, buyerUsername: "maria_shops", recipientName: null,
  storeId: "Store A", recStore: "Store A", status: "at_store", statusMessage: null, pickupDeadline: "2026-11-05",
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, orderAmount: 380, ...over,
});
// one parcel whose buyer name is not a TikTok username → the "Copy" button (the CI case, onCopy)
const ROWS = [row("1", { buyerUsername: "陳小美" }), row("2")];
const status = (): TrackingStatus => ({
  last_completed_at: null, next_available_at: null, used_today: false, urgent_used_today: false, active_job: null, last_job: null,
});
const view = (contactOn = false) => render(<TProvider lang="en"><ParcelTracking contactOn={contactOn} /></TProvider>);
const toastOf = (r: ReturnType<typeof view>) => r.queryByTestId("pt-toast")?.textContent ?? null;
// let the awaits inside a tap finish (the fake clock is not moved)
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** The page is gone — what the test runner does when a test file ends. From here any React state
 *  update throws "window is not defined" (the CI error). Runs fn, then puts the page back. */
function withThePageGone(fn: () => void) {
  const d = Object.getOwnPropertyDescriptor(globalThis, "window");
  expect(Reflect.deleteProperty(globalThis, "window")).toBe(true);
  try {
    expect(typeof window).toBe("undefined"); // the detector is really armed
    fn();
  } finally {
    if (d) Object.defineProperty(globalThis, "window", d);
  }
}
/** After the screen closed: nothing of it is left on the clock, and running the clock far past
 *  every toast time — with the page gone — updates no state. Both are read before either is
 *  judged, so a failure shows the whole picture (the old code: 1 timer left + the CI error). */
function expectNothingLate() {
  const timersLeft = vi.getTimerCount();
  let lateUpdate: string | null = null;
  withThePageGone(() => {
    try { vi.advanceTimersByTime(60_000); } catch (e) { lateUpdate = String((e as Error).message); }
  });
  expect({ timersLeft, lateUpdate }).toEqual({ timersLeft: 0, lateUpdate: null });
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS });
  loadTrackingStatus.mockReset(); loadTrackingStatus.mockResolvedValue(status());
  requestCheck.mockReset(); requestCheck.mockResolvedValue({ ok: true, reason: "queued" });
  loadBuyerContacts.mockReset(); loadBuyerContacts.mockResolvedValue({ s711: new Map(), fm: new Map() } as ContactMaps);
  copyText.mockReset(); copyText.mockResolvedValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe("the detector itself (so the checks below cannot pass by accident)", () => {
  it("with the page gone, a state update on a closed screen throws the CI error", async () => {
    // a tiny screen with the OLD pattern: a timer that sets state and is never stopped
    const { useState } = await import("react");
    function Old() {
      const [x, setX] = useState("");
      return <button data-testid="old" onClick={() => { setX("shown"); setTimeout(() => setX(""), 1500); }}>{x}</button>;
    }
    const r = render(<Old />);
    fireEvent.click(r.getByTestId("old"));
    r.unmount();
    expect(vi.getTimerCount()).toBe(1);
    let thrown: unknown = null;
    withThePageGone(() => { try { vi.advanceTimersByTime(60_000); } catch (e) { thrown = e; } });
    expect(thrown).toBeInstanceOf(ReferenceError);
    expect(String((thrown as Error).message)).toBe("window is not defined");
  });
});

describe("close the screen right after a toast → no late state update", () => {
  it("after a copy (the CI case: the 1.5 s \"Copied\" timer)", async () => {
    const r = view();
    const copy = await r.findByTestId("pt-copy-username");
    fireEvent.click(copy);
    await waitFor(() => expect(toastOf(r)).toBe("Copied"));
    expect(copyText).toHaveBeenCalledWith("陳小美");
    r.unmount();
    expectNothingLate();
  });

  it("after a message copy", async () => {
    const r = view(true);
    const msg = (await r.findAllByTestId("pt-copy-msg"))[0];
    fireEvent.click(msg);
    await waitFor(() => expect(toastOf(r)).toBe("Message copied"));
    r.unmount();
    expectNothingLate();
  });

  it("after a refused check (the 5 s message)", async () => {
    requestCheck.mockResolvedValue({ ok: false, reason: "already_queued" });
    const r = view();
    const b = await r.findByTestId("pt-check-now");
    await waitFor(() => expect(b.getAttribute("data-state")).toBe("ready"));
    fireEvent.click(b);
    await waitFor(() => expect(toastOf(r)).toBe("A check is already running."));
    r.unmount();
    expectNothingLate();
  });

  it("with three toasts still on the clock at once (copy, message copy, refused check)", async () => {
    requestCheck.mockResolvedValue({ ok: false, reason: "already_queued" });
    const r = view(true);
    const b = await r.findByTestId("pt-check-now");
    await waitFor(() => expect(b.getAttribute("data-state")).toBe("ready"));
    fireEvent.click(b);
    await waitFor(() => expect(toastOf(r)).toBe("A check is already running."));
    fireEvent.click(r.getByTestId("pt-copy-username"));
    await waitFor(() => expect(toastOf(r)).toBe("Copied"));
    fireEvent.click(r.getAllByTestId("pt-copy-msg")[0]);
    await waitFor(() => expect(toastOf(r)).toBe("Message copied"));
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(3);
    r.unmount();
    expectNothingLate();
  });
});

describe("an answer that arrives after the screen closed starts nothing", () => {
  it("a copy still on its way when the screen closes", async () => {
    let answer: (ok: boolean) => void = () => {};
    copyText.mockImplementation(() => new Promise<boolean>((res) => { answer = res; }));
    const r = view();
    fireEvent.click(await r.findByTestId("pt-copy-username"));
    expect(copyText).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
    answer(true);
    await settle();
    expectNothingLate(); // the old code started a new 1.5 s timer here
  });

  it("a check still on its way when the screen closes", async () => {
    let answer: (v: unknown) => void = () => {};
    requestCheck.mockImplementation(() => new Promise((res) => { answer = res; }));
    const r = view();
    const b = await r.findByTestId("pt-check-now");
    await waitFor(() => expect(b.getAttribute("data-state")).toBe("ready"));
    fireEvent.click(b);
    expect(requestCheck).toHaveBeenCalledTimes(1);
    r.unmount();
    answer({ ok: false, reason: "error" });
    await settle();
    expectNothingLate(); // the old code started a new 5 s timer here
  });
});

describe("while the screen is open nothing changed for the seller", () => {
  it("\"Copied\" shows for 1.5 s, then goes", async () => {
    vi.useFakeTimers(); // this one moves the clock by hand
    const r = view();
    await settle();
    fireEvent.click(r.getByTestId("pt-copy-username"));
    await settle();
    expect(toastOf(r)).toBe("Copied");
    await tick(1400);
    expect(toastOf(r)).toBe("Copied");
    await tick(200);
    expect(toastOf(r)).toBeNull();
    expect(vi.getTimerCount()).toBe(0); // a timer that has done its work is forgotten
    r.unmount();
  });

  it("a check message shows for 5 s, then goes", async () => {
    vi.useFakeTimers();
    requestCheck.mockResolvedValue({ ok: false, reason: "already_queued" });
    const r = view();
    await settle();
    fireEvent.click(r.getByTestId("pt-check-now"));
    await settle();
    expect(toastOf(r)).toBe("A check is already running.");
    await tick(4900);
    expect(toastOf(r)).toBe("A check is already running.");
    await tick(200);
    expect(toastOf(r)).toBeNull();
    r.unmount();
  });

  it("each toast keeps its OWN timer, as before: an older toast's timer still hides a newer toast when it ends", async () => {
    // Today's behaviour, kept on purpose (the fix changes nothing the seller sees):
    // 0 s  check message (5 s) · 4 s  "Copied" (1.5 s) · 5 s  the first timer ends → the toast goes.
    vi.useFakeTimers();
    requestCheck.mockResolvedValue({ ok: false, reason: "already_queued" });
    const r = view();
    await settle();
    fireEvent.click(r.getByTestId("pt-check-now"));
    await settle();
    await tick(4000);
    fireEvent.click(r.getByTestId("pt-copy-username"));
    await settle();
    expect(toastOf(r)).toBe("Copied");
    await tick(900);
    expect(toastOf(r)).toBe("Copied");
    await tick(200);                       // 5.1 s: the check message's timer
    expect(toastOf(r)).toBeNull();
    r.unmount();
    expectNothingLate();                   // … and the "Copied" timer (still 0.4 s to go) is stopped
  });
});

describe("the screen's own code", () => {
  const src = readFileSync("src/redesign/screens/ParcelTracking.tsx", "utf8");
  it("every toast goes through showToast — no other timer sets the toast", () => {
    // setToast is called in exactly two places, both inside showToast (show, then hide)
    const calls = src.match(/\bsetToast\(/g) ?? [];
    expect(calls).toHaveLength(2);
    const body = src.slice(src.indexOf("const showToast = "), src.indexOf("const apply = "));
    expect(body.match(/\bsetToast\(/g) ?? []).toHaveLength(2);
    expect(body).toContain("if (!screenOpen.current) return;");
    expect(body).toContain("toastTimers.current.add(id)");
  });
  it("the screen stops every remembered timer when it closes", () => {
    expect(src).toMatch(/screenOpen\.current = false;\s*\n\s*for \(const id of timers\) clearTimeout\(id\);\s*\n\s*timers\.clear\(\);/);
  });
});
