// "Who is checking" — the app side of GET /admin/pc711/duty (adapters/pc711Duty.ts).
//   A  the answer → what the card shows (and what is refused)
//   B  the small text helpers
//   C  WHEN the server is asked: once when the panel opens, then every 30 seconds while the page is
//      in front; never while it is hidden; nothing at all after the panel closes
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  toPc711Duty, dutyState, serverOnDuty, spanWords, taipeiMinute, taipeiRange, usePc711Duty, DUTY_REFRESH_MS,
  type Pc711Duty,
} from "../pc711Duty";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const NOW = Date.parse("2026-11-18T06:08:00Z");                    // 14:08 Taipei
const iso = (ms: number) => new Date(ms).toISOString();
const answer = (over: Record<string, unknown> = {}) => ({
  backup: "on", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
  checker: { label: "Lenovo", lastCallAt: iso(NOW - 4000) }, last: null, now: iso(NOW), ...over,
});
const ON_DUTY = { onDuty: true, reason: "silent", since: iso(NOW - 22 * 60_000), answered: 37 };

describe("A — the answer", () => {
  it("normal / on duty / on duty and logged out / off → the four states", () => {
    expect(dutyState(toPc711Duty(answer(), NOW)!)).toBe("normal");
    expect(dutyState(toPc711Duty(answer(ON_DUTY), NOW)!)).toBe("duty");
    expect(dutyState(toPc711Duty(answer({ ...ON_DUTY, loggedOut: true }), NOW)!)).toBe("duty_out");
    expect(dutyState(toPc711Duty(answer({ backup: "off" }), NOW)!)).toBe("off");
    // logged out while the Lenovo is checking is still "normal" (the panel's own red card says the rest)
    expect(dutyState(toPc711Duty(answer({ loggedOut: true }), NOW)!)).toBe("normal");
  });
  it("on duty: since, why, the count; the Lenovo's last call; the last take-over", () => {
    const d = toPc711Duty(answer({ ...ON_DUTY, answeredMore: true, last: { start: iso(NOW - 3 * 3600_000), end: iso(NOW - 2 * 3600_000), reason: "degraded" } }), NOW)!;
    expect(d).toEqual({
      backup: "on", onDuty: true, loggedOut: false, reason: "silent", since: iso(NOW - 22 * 60_000), answered: 37, answeredMore: true,
      label: "Lenovo", lastCallAt: iso(NOW - 4000), last: { start: iso(NOW - 3 * 3600_000), end: iso(NOW - 2 * 3600_000), reason: "degraded" }, skewMs: 0,
    } satisfies Pc711Duty);
  });
  it("backup off: nothing of a duty is kept, whatever the answer carries", () => {
    const d = toPc711Duty(answer({ backup: "off", ...ON_DUTY, answeredMore: true }), NOW)!;
    expect([d.onDuty, d.reason, d.since, d.answered, d.answeredMore]).toEqual([false, null, null, null, false]);
    expect(serverOnDuty(d)).toBe(false);
  });
  it("serverOnDuty: only a real \"on duty\" answer", () => {
    expect(serverOnDuty(toPc711Duty(answer(ON_DUTY), NOW))).toBe(true);
    expect(serverOnDuty(toPc711Duty(answer(), NOW))).toBe(false);
    expect(serverOnDuty(null)).toBe(false);
    expect(serverOnDuty(undefined)).toBe(false);
  });
  it("not the expected shape → no answer (the card says it could not read)", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { backup: "maybe" }, { error: "failed" }, { success: false, error: "forbidden" }]) expect(toPc711Duty(bad, NOW)).toBeNull();
  });
  it("values that are not what they should be are dropped, never shown", () => {
    const d = toPc711Duty(answer({ ...ON_DUTY, reason: "0912345678", since: "yesterday", answered: "37 <b>", checker: { label: "Maria Santos", lastCallAt: "soon" },
      last: { start: iso(NOW), end: iso(NOW - 1), reason: "silent" } }), NOW)!;
    expect([d.reason, d.since, d.answered, d.label, d.lastCallAt, d.last]).toEqual([null, null, null, "", null, null]);
    for (const label of ["0912345678", "Store 151003", "F12345678", "王小美", "a".repeat(21)]) expect(toPc711Duty(answer({ checker: { label, lastCallAt: null } }), NOW)!.label).toBe("");
    for (const label of ["Lenovo", "Mac fe08", "Lenovo-2"]) expect(toPc711Duty(answer({ checker: { label, lastCallAt: null } }), NOW)!.label).toBe(label);
    expect(toPc711Duty(answer({ ...ON_DUTY, answered: -1 }), NOW)!.answered).toBeNull();
    expect(toPc711Duty(answer({ ...ON_DUTY, answered: 0 }), NOW)!.answered).toBe(0);
  });
  it("skew = the server's clock minus this device's clock (so a wrong phone clock does not change \"… ago\")", () => {
    expect(toPc711Duty(answer({ now: iso(NOW + 90_000) }), NOW)!.skewMs).toBe(90_000);
    expect(toPc711Duty(answer({ now: iso(NOW - 5000) }), NOW)!.skewMs).toBe(-5000);
    expect(toPc711Duty(answer({ now: "x" }), NOW)!.skewMs).toBe(0);
  });
});

describe("B — the text helpers", () => {
  it("spanWords", () => {
    expect([0, 999, 4000, 59_999].map(spanWords)).toEqual(["0 s", "0 s", "4 s", "59 s"]);
    expect([60_000, 22 * 60_000, 59 * 60_000 + 59_000].map(spanWords)).toEqual(["1 min", "22 min", "59 min"]);
    expect([3600_000, 72 * 60_000, 47 * 3600_000 + 59 * 60_000].map(spanWords)).toEqual(["1 h", "1 h 12 min", "47 h 59 min"]);
    expect([48 * 3600_000, 76 * 3600_000].map(spanWords)).toEqual(["2 d", "3 d 4 h"]);
    expect([-5000, NaN, Infinity].map(spanWords)).toEqual(["0 s", "0 s", "0 s"]);
  });
  it("Taipei times: \"11/18 13:46\"; a range on one day shows the day once", () => {
    expect(taipeiMinute("2026-11-18T05:46:12Z")).toBe("11/18 13:46");
    expect(taipeiMinute(null)).toBe("—");
    expect(taipeiMinute("x")).toBe("—");
    expect(taipeiRange("2026-11-16T19:12:00Z", "2026-11-16T19:58:00Z")).toBe("11/17 03:12 → 03:58");
    expect(taipeiRange("2026-11-17T15:50:00Z", "2026-11-17T16:36:00Z")).toBe("11/17 23:50 → 11/18 00:36");
  });
});

// ── C: when the server is asked ───────────────────────────────────────────────────────────────
type Held = { release: () => void };
let calls: { path: string; method: string; auth: string }[] = [];
let next: Array<{ ok?: boolean; status?: number; body?: unknown; throws?: boolean; hold?: Promise<void> }> = [];
let vis: "visible" | "hidden" = "visible";
const setInFront = (v: boolean) => { vis = v ? "visible" : "hidden"; act(() => { document.dispatchEvent(new Event("visibilitychange")); }); };
const settle = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const hold = (): Held & { p: Promise<void> } => { let release = () => {}; const p = new Promise<void>((r) => { release = r; }); return { release, p }; };
const dutyCalls = () => calls.filter((c) => c.path === "/admin/pc711/duty").length;

function Probe({ open = true }: { open?: boolean }) {
  const d = usePc711Duty(open);
  return <div data-testid="probe" data-kind={d === undefined ? "loading" : d === null ? "failed" : dutyState(d)} />;
}
const kind = (r: ReturnType<typeof render>) => r.getByTestId("probe").getAttribute("data-kind");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  calls = []; next = []; vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ path: new URL(url, "http://x").pathname, method: init?.method || "GET", auth: String(init?.headers?.Authorization || "") });
    const r = next.shift() || { body: answer() };
    if (r.hold) await r.hold;
    if (r.throws) throw new Error("offline");
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? answer() };
  });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe("C — when the server is asked", () => {
  it("once when the panel opens: one GET of the Admin route with the admin's login", async () => {
    const r = render(<Probe />);
    expect(kind(r)).toBe("loading");
    await settle();
    expect(calls).toEqual([{ path: "/admin/pc711/duty", method: "GET", auth: "Bearer t" }]);
    expect(kind(r)).toBe("normal");
    r.unmount();
  });
  it("then every 30 seconds while the page is in front", async () => {
    expect(DUTY_REFRESH_MS).toBe(30_000);
    const r = render(<Probe />);
    await settle();
    await tick(29_900);
    expect(dutyCalls()).toBe(1);
    await tick(100);
    expect(dutyCalls()).toBe(2);
    await tick(30_000);
    expect(dutyCalls()).toBe(3);
    await tick(5 * 60_000);
    expect(dutyCalls()).toBe(13);                        // 10 more in 5 minutes — never faster
    r.unmount();
  });
  it("a new answer replaces the old one", async () => {
    const r = render(<Probe />);
    await settle();
    expect(kind(r)).toBe("normal");
    next.push({ body: answer(ON_DUTY) });
    await tick(30_000);
    expect(kind(r)).toBe("duty");
    next.push({ body: answer({ ...ON_DUTY, loggedOut: true }) });
    await tick(30_000);
    expect(kind(r)).toBe("duty_out");
    next.push({ body: answer({ backup: "off" }) });
    await tick(30_000);
    expect(kind(r)).toBe("off");
    r.unmount();
  });
  it("NO refresh while the page is hidden — however long", async () => {
    const r = render(<Probe />);
    await settle();
    await tick(10_000);
    setInFront(false);
    expect(vi.getTimerCount()).toBe(0);                  // nothing is even waiting
    await tick(60 * 60_000);
    expect(dutyCalls()).toBe(1);
    r.unmount();
  });
  it("back in front after a while: asked at once, then every 30 seconds again", async () => {
    const r = render(<Probe />);
    await settle();
    setInFront(false);
    await tick(10 * 60_000);
    expect(dutyCalls()).toBe(1);
    setInFront(true);
    await tick(0);
    expect(dutyCalls()).toBe(2);
    await tick(29_999);
    expect(dutyCalls()).toBe(2);
    await tick(1);
    expect(dutyCalls()).toBe(3);
    r.unmount();
  });
  it("back in front before the 30 seconds are over: no extra read — the next one comes when they are", async () => {
    const r = render(<Probe />);
    await settle();
    await tick(5000);
    setInFront(false);
    await tick(5000);
    setInFront(true);                                    // 10 s after the read
    await tick(19_999);
    expect(dutyCalls()).toBe(1);
    await tick(1);
    expect(dutyCalls()).toBe(2);
    // flipping back and forth never adds a read or a second timer
    for (let i = 0; i < 6; i++) { setInFront(false); setInFront(true); }
    expect(vi.getTimerCount()).toBe(1);
    await tick(29_999);
    expect(dutyCalls()).toBe(2);
    r.unmount();
  });
  it("the browser says \"in front\" again while the page already is → no second timer, no extra read", async () => {
    const r = render(<Probe />);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    for (let i = 0; i < 5; i++) act(() => { document.dispatchEvent(new Event("visibilitychange")); });   // still "visible"
    expect(vi.getTimerCount()).toBe(1);
    await tick(30_000);
    expect(dutyCalls()).toBe(2);
    await tick(30_000);
    expect(dutyCalls()).toBe(3);
    r.unmount();
  });
  it("the page is hidden when the panel opens → nothing is asked until it is in front", async () => {
    vis = "hidden";
    const r = render(<Probe />);
    await settle();
    await tick(5 * 60_000);
    expect(dutyCalls()).toBe(0);
    expect(kind(r)).toBe("loading");
    setInFront(true);
    await tick(0);
    expect(dutyCalls()).toBe(1);
    expect(kind(r)).toBe("normal");
    r.unmount();
  });
  it("the page goes behind just as a read is due → that read is not sent", async () => {
    const r = render(<Probe />);
    await settle();
    await tick(29_999);
    vis = "hidden";                                      // hidden, and the page did not tell us (no event)
    await tick(10_000);
    expect(dutyCalls()).toBe(1);
    r.unmount();
  });
  it("an answer that arrives while the page is hidden is shown, but plans no further read", async () => {
    const h = hold();
    next.push({ hold: h.p, body: answer(ON_DUTY) });
    const r = render(<Probe />);
    await settle();
    setInFront(false);
    h.release();
    await settle();
    expect(kind(r)).toBe("duty");
    expect(vi.getTimerCount()).toBe(0);
    await tick(10 * 60_000);
    expect(dutyCalls()).toBe(1);
    r.unmount();
  });
  it("one read at a time: a slow answer never piles up reads", async () => {
    const h = hold();
    next.push({ hold: h.p });
    const r = render(<Probe />);
    await settle();
    await tick(5 * 60_000);
    expect(dutyCalls()).toBe(1);                         // still waiting for the first answer
    for (let i = 0; i < 4; i++) { setInFront(false); setInFront(true); }
    expect(vi.getTimerCount()).toBe(0);                  // … and nothing spins while it waits
    await tick(60_000);
    expect(dutyCalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    h.release();
    await settle();
    expect(kind(r)).toBe("normal");
    await tick(0);
    expect(dutyCalls()).toBe(2);                         // the next one was long due
    await tick(29_999);
    expect(dutyCalls()).toBe(2);
    r.unmount();
  });
  it("the status view is not shown (open = false) → nothing is asked; showing it asks; leaving it stops", async () => {
    const r = render(<Probe open={false} />);
    await settle();
    await tick(5 * 60_000);
    expect(dutyCalls()).toBe(0);
    r.rerender(<Probe open />);
    await settle();
    expect(dutyCalls()).toBe(1);
    await tick(30_000);
    expect(dutyCalls()).toBe(2);
    r.rerender(<Probe open={false} />);
    expect(vi.getTimerCount()).toBe(0);
    await tick(5 * 60_000);
    expect(dutyCalls()).toBe(2);
    r.unmount();
  });
  it("a read that fails → \"could not read\", and the next one is tried 30 seconds later", async () => {
    next.push({ ok: false, status: 500, body: { error: "failed" } });
    const r = render(<Probe />);
    await settle();
    expect(kind(r)).toBe("failed");
    next.push({ throws: true });
    await tick(30_000);
    expect(kind(r)).toBe("failed");
    next.push({ ok: false, status: 403, body: { success: false, error: "forbidden" } });
    await tick(30_000);
    expect(kind(r)).toBe("failed");
    next.push({ body: { something: "else" } });
    await tick(30_000);
    expect(kind(r)).toBe("failed");
    // a refused request is never read as an answer, even when its body looks like one
    next.push({ ok: false, status: 500, body: answer(ON_DUTY) });
    await tick(30_000);
    expect(kind(r)).toBe("failed");
    next.push({ ok: false, status: 403, body: answer() });
    await tick(30_000);
    expect(kind(r)).toBe("failed");
    await tick(30_000);
    expect(kind(r)).toBe("normal");
    expect(dutyCalls()).toBe(7);
    r.unmount();
  });
});

describe("C — after the panel closes nothing is left", () => {
  /** The page is gone (what the test runner does when a file ends): any React state update now throws
   *  "window is not defined" — the CI error of run 1843. */
  const pageGone = () => {
    const d = Object.getOwnPropertyDescriptor(globalThis, "window");
    expect(Reflect.deleteProperty(globalThis, "window")).toBe(true);
    return () => { if (d) Object.defineProperty(globalThis, "window", d); };
  };
  it("no timer, no listener, no request", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const ours = (spy: typeof added) => spy.mock.calls.filter((c) => c[0] === "visibilitychange").map((c) => c[1]);
    const r = render(<Probe />);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    expect(ours(added)).toHaveLength(1);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(ours(removed as unknown as typeof added)).toEqual(ours(added));   // the very same listener is taken away
    added.mockRestore(); removed.mockRestore();
    vis = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    vis = "visible"; document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    const back = pageGone();
    let thrown: unknown = null;
    try { vi.advanceTimersByTime(60 * 60_000); } catch (e) { thrown = e; } finally { back(); }
    expect(thrown).toBeNull();
    expect(dutyCalls()).toBe(1);
  });
  it("an answer that arrives after the panel closed changes nothing", async () => {
    const rejected: unknown[] = [];
    const onRejected = (e: unknown) => { rejected.push(e); };
    process.on("unhandledRejection", onRejected);
    try {
      const h = hold();
      next.push({ hold: h.p });
      const r = render(<Probe />);
      await settle();
      expect(dutyCalls()).toBe(1);
      r.unmount();
      const back = pageGone();
      try {
        h.release();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      } finally { back(); }
      expect(vi.getTimerCount()).toBe(0);                // … and it plans no further read
      vi.useRealTimers();
      await new Promise((res) => setTimeout(res, 20));   // let a late error surface
      expect(rejected.map((e) => String((e as Error)?.message ?? e))).toEqual([]);
      expect(dutyCalls()).toBe(1);
    } finally { process.off("unhandledRejection", onRejected); }
  });
});
