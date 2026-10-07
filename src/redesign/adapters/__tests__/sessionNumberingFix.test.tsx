// Session-numbering fix, commit 1 (staged by sessionNumberingGate). Gate ON cases:
// legacy seller unchanged · failed window / session reads → unknown / failed (never a
// day-only guess, never an empty board you can order on) · retries · Refresh and Taipei
// midnight while unknown · reset closes the order gate synchronously · the order gate in
// useOrders · the gate decision · how long the gate is closed on a normal open.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

type Res = { data: unknown; error: unknown };
const db = vi.hoisted(() => ({
  day: "2026-10-04",
  sessionRow: { current_session_id: null as string | null, session_started_at: null as string | null, session_window_days: null as number | null },
  mountFail: 0, windowFail: 0, ordersFail: 0, // how many times the next reads fail
  windowCfg: { window_days: 1, window_start: null as string | null },
  delay: { mount: 0, window: 0, orders: 0 },
  log: [] as string[],
  uid: "u1" as string | null,
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => db.day }));
vi.mock("../../../supabase", () => {
  const wait = (ms: number) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const builder = (table: string) => {
    const f: Record<string, unknown> = {}; let sel = "";
    const q: Record<string, unknown> = {};
    for (const op of ["order", "range", "limit"]) q[op] = () => q;
    q.select = (s: string) => { sel = s; return q; };
    q.eq = (c: string, v: unknown) => { f[c] = v; return q; };
    q.gte = (_c: string, v: unknown) => { f.from = v; return q; };
    q.lte = (_c: string, v: unknown) => { f.to = v; return q; };
    const answer = async (): Promise<Res> => {
      if (table === "seller_session_config" && sel.includes("current_session_id")) {
        await wait(db.delay.mount); db.log.push("mount-read");
        if (db.mountFail > 0) { db.mountFail--; return { data: null, error: { message: "net" } }; }
        return { data: db.sessionRow, error: null };
      }
      if (table === "seller_session_config") {
        await wait(db.delay.window); db.log.push("window-read");
        if (db.windowFail > 0) { db.windowFail--; return { data: null, error: { message: "net" } }; }
        return { data: db.windowCfg, error: null };
      }
      if (table === "live_session_orders") {
        await wait(db.delay.orders);
        db.log.push(f.session_id ? `load-session ${String(f.session_id)}` : `load-day ${String(f.from)}..${String(f.to)}`);
        if (db.ordersFail > 0) { db.ordersFail--; return { data: null, error: { message: "net" } }; }
        return { data: [{ buyer_number: 1, handle: "@a", customer_name: "A", platform: "TikTok", product: "100", price: 100, created_at: `${db.day}T01:00:00Z`, session_date: db.day, comment_msg_id: null, qty: 1, auto_code: null }], error: null };
      }
      return { data: null, error: null };
    };
    q.maybeSingle = answer;
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => answer().then(ok, bad);
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: db.uid ? { user: { id: db.uid } } : null } }) },
      from: (t: string) => builder(t),
      rpc: async () => ({ data: [{ running: !!db.sessionRow.current_session_id, session_id: db.sessionRow.current_session_id, session_platform: "TikTok" }], error: null }),
    },
  };
});

import { useSessionWindow, loadLiveSessionBySessionId } from "../useSessionWindow";
import { useSessionInstance } from "../useSessionInstance";
import { useLiveSession, SESSION_LOAD_RETRY_MS } from "../useLiveSession";
import { sessionNumberingGate, SESSION_NUMBERING_FIX_EMAILS, SESSION_NUMBERING_FIX_PUBLIC } from "../sessionNumberingGate";

function useApp({ authed, fix }: { authed: boolean; fix: boolean }) {
  const sessionWindow = useSessionWindow(authed, fix);
  const sessionInstance = useSessionInstance(authed, fix);
  const liveSession = useLiveSession(authed, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId, fix, sessionKnown: sessionInstance.known, windowKnown: sessionWindow.known });
  return { sessionWindow, sessionInstance, liveSession };
}
const open = () => {
  const h = renderHook((p: { authed: boolean; fix: boolean }) => useApp(p), { initialProps: { authed: false, fix: false } });
  h.rerender({ authed: true, fix: true });
  return h;
};
const tick = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const focus = () => act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  db.day = "2026-10-04"; db.sessionRow = { current_session_id: null, session_started_at: null, session_window_days: null };
  db.mountFail = 0; db.windowFail = 0; db.ordersFail = 0; db.windowCfg = { window_days: 1, window_start: null };
  db.delay = { mount: 0, window: 0, orders: 0 }; db.log = []; db.uid = "u1";
});
afterEach(() => { vi.useRealTimers(); });

describe("the gate decision (email only)", () => {
  it("on for the listed emails (any case), off for others, wait while signed in without an email, off when signed out", () => {
    expect(SESSION_NUMBERING_FIX_PUBLIC).toBe(true);
    // public: on for every signed-in account, even before the email is known; off when signed out
    expect(sessionNumberingGate(true, "someone@else.com")).toBe("on");
    expect(sessionNumberingGate(true, null)).toBe("on");
    expect(sessionNumberingGate(false, "someone@else.com")).toBe("off");
    const LIST = ["camilajeffrey1@gmail.com", "googletest@gmail.com", "googletest@sellerflowlive.com", "cristycabanas34@gmail.com", "tincabanas13@gmail.com", "ronaldgantiga77@gmail.com",
      "aubreylucero15@yahoo.com", "716030huan@gmail.com", "bardagulanjavier@gmail.com", "zandracruz@icloud.com", "chungmaychilleann@gmail.com",
      "gee383838@icloud.com", "rominamagat@gmail.com", "juvieho0725@gmail.com", "clarabhie@gmail.com", "mersteve17@gmail.com",
      "jinkyrosepenana@gmail.com", "basaomenchie6@gmail.com", "jaszhu127@gmail.com", "leinapan@gmail.com", "jobelleolivas80@gmail.com", "merriamalmirante194@gmail.com", "apzelejorde@yahoo.com", "s076561908@hotmail.com", "ailun09291990@gmail.com", "ganggang0958@yahoo.com",
      "abeyverdera@yahoo.com", "christinechen769@gmail.com", "z30983359299@gmail.com", "vans0814@gmail.com", "rodelio.martinjr@gmail.com", "michellesebios86@gmail.com", "nashtex@abv.bg", "leahsangalang1215@gmail.com", "sanggalanglhea@gmail.com", "ukaydaily1@gmail.com", "lheyukay@gmail.com", "angelicasu08@gmail.com"];
    expect(SESSION_NUMBERING_FIX_EMAILS).toEqual(LIST); // the exact staged list
    for (const e of LIST) {
      expect(SESSION_NUMBERING_FIX_EMAILS).toContain(e);
      expect(sessionNumberingGate(true, e.toUpperCase(), false)).toBe("on");
    }
    // the staged path (publicFlag false = the constant flipped back): list only
    expect(sessionNumberingGate(true, "someone@else.com", false)).toBe("off");
    expect(sessionNumberingGate(true, null, false)).toBe("wait");
    expect(sessionNumberingGate(true, "  ", false)).toBe("wait");
    expect(sessionNumberingGate(false, "camilajeffrey1@gmail.com", false)).toBe("off");
  });
  it("RedesignApp: hooks get sessionHooksOn (= authed unless 'wait') + sessionFix; the order gate only when on", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const sessionGate = sessionNumberingGate(authed, auth.email);");
    expect(src).toContain('const sessionHooksOn = authed && sessionGate !== "wait";');
    expect(src).toContain("useSessionWindow(sessionHooksOn, sessionFix)");
    expect(src).toContain("useSessionInstance(sessionHooksOn, sessionFix)");
    expect(src).toMatch(/useLiveSession\(authed, \{ ready: sessionWindow\.loaded && sessionInstance\.loaded && sessionGate !== "wait",[^}]*fix: sessionFix, sessionKnown: sessionInstance\.known, windowKnown: sessionWindow\.known \}\)/);
    expect(src).toContain("...(sessionFix ? { canOrder: liveSession.canOrder, onOrderBlocked: () => setOrderBlocked((c) => c + 1) } : {}),");
    // the notice + Retry render only for the gate-on account, only when failed / unknown
    expect(src).toContain('{screen === "dashboard" && sessionFix && (liveSession.loadStatus === "failed" || liveSession.loadStatus === "unknown") && (');
    expect(src).toContain("sessionInstance.retry(); sessionWindow.retry(); liveSession.retry();");
  });
});

describe("gate on — legacy seller (read succeeds, no session) behaves as today", () => {
  it("loads today's day board after the config reads; orders allowed", async () => {
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    expect(h.result.current.sessionInstance.known).toBe(true);
    expect(db.log).toContain("load-day 2026-10-04..2026-10-04");
    expect(h.result.current.liveSession.session.orders).toHaveLength(1);
    expect(h.result.current.liveSession.canOrder()).toBe(true);
  });
  it("a multi-day legacy window is loaded as a range (never a day-only first)", async () => {
    db.windowCfg = { window_days: 3, window_start: "2026-10-03" };
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    expect(db.log.filter((l) => l.startsWith("load-day"))).toEqual(["load-day 2026-10-03..2026-10-04"]);
  });
  it("Taipei midnight still resets a known legacy 1-day board", async () => {
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    db.day = "2026-10-05";
    await focus();
    await waitFor(() => expect(db.log).toContain("load-day 2026-10-05..2026-10-05"));
  });
});

describe("gate on — failed reads are unknown, never 'no session'", () => {
  it("window config read fails (no session) → unknown: no day load, orders blocked; focus re-reads → ok", async () => {
    db.windowFail = 1;
    const h = open();
    await tick();
    expect(h.result.current.liveSession.loadStatus).toBe("unknown");
    expect(h.result.current.liveSession.canOrder()).toBe(false);
    expect(db.log.some((l) => l.startsWith("load-"))).toBe(false);
    await focus();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
  });
  it("missing user id at the session read → unknown (not 'no session')", async () => {
    db.uid = null;
    const h = open();
    await tick();
    expect(h.result.current.sessionInstance.loaded).toBe(true);
    expect(h.result.current.sessionInstance.known).toBe(false);
    expect(h.result.current.liveSession.loadStatus).toBe("unknown");
    db.uid = "u1";
    await act(async () => { h.result.current.sessionInstance.retry(); h.result.current.sessionWindow.retry(); }); // = the notice's Retry
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
  });
  it("Refresh (reset) while unknown does not load day-only", async () => {
    db.mountFail = 5;
    const h = open();
    await tick();
    await act(async () => { h.result.current.liveSession.reset(); });
    await tick();
    expect(db.log.some((l) => l.startsWith("load-"))).toBe(false);
    expect(h.result.current.liveSession.canOrder()).toBe(false);
  });
  it("Taipei midnight while unknown → no legacy reset, no day load", async () => {
    db.mountFail = 5;
    open();
    await tick();
    db.day = "2026-10-05";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await tick();
    expect(db.log.some((l) => l.startsWith("load-"))).toBe(false);
  });
});

describe("gate on — a failed board load is 'failed', retried, and never orderable", () => {
  it("session load fails → failed (board empty, orders blocked) → automatic retry → ok", async () => {
    db.sessionRow = { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 };
    db.ordersFail = 1;
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("failed"));
    expect(h.result.current.liveSession.state).toBe("empty"); // display unchanged (loadError test)
    expect(h.result.current.liveSession.canOrder()).toBe(false);
    expect(SESSION_LOAD_RETRY_MS[0]).toBe(3000);
    await act(async () => { await new Promise((r) => setTimeout(r, SESSION_LOAD_RETRY_MS[0] + 50)); });
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    expect(db.log.filter((l) => l === "load-session S1")).toHaveLength(2);
  }, 10_000);
  it("loadLiveSessionBySessionId strict: no user id → null (failed); default → [] (today)", async () => {
    db.uid = null;
    expect(await loadLiveSessionBySessionId("S1", true)).toBeNull();
    expect(await loadLiveSessionBySessionId("S1")).toEqual([]);
  });
  it("reset() closes the order gate synchronously (no order on the momentarily empty board)", async () => {
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.canOrder()).toBe(true));
    let during = true;
    act(() => { h.result.current.liveSession.reset(); during = h.result.current.liveSession.canOrder(); });
    expect(during).toBe(false);
    await waitFor(() => expect(h.result.current.liveSession.canOrder()).toBe(true));
  });
});

describe("how long the order gate is closed on a normal open (measured)", () => {
  it("≈ slower config read + the board load (simulated 150 ms + 250 ms → ~400 ms)", async () => {
    db.sessionRow = { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 };
    db.delay = { mount: 150, window: 120, orders: 250 };
    const t0 = Date.now();
    const h = open();
    expect(h.result.current.liveSession.canOrder()).toBe(false);
    await waitFor(() => expect(h.result.current.liveSession.canOrder()).toBe(true), { timeout: 3000, interval: 5 });
    const closedMs = Date.now() - t0;
    expect(closedMs).toBeGreaterThanOrEqual(390);
    expect(closedMs).toBeLessThan(800);
    console.info(`[gate] closed for ${closedMs} ms (config 150 ms + board 250 ms)`);
  });
});

describe("gate on — 'loaded' never carries over from a signed-out pass or a previous sign-in", () => {
  it("signed-out pass with the fix on, then sign-in with a slow read → nothing loads until the read answers", async () => {
    db.sessionRow = { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 };
    db.delay.mount = 80; db.delay.window = 80;
    const h = renderHook((p: { authed: boolean; fix: boolean }) => useApp(p), { initialProps: { authed: false, fix: true } });
    await tick();
    h.rerender({ authed: true, fix: true });
    expect(h.result.current.sessionInstance.loaded).toBe(false);
    expect(h.result.current.sessionWindow.loaded).toBe(false);
    await tick(30);
    expect(db.log.some((l) => l.startsWith("load-"))).toBe(false);
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    expect(db.log.filter((l) => l.startsWith("load-"))).toEqual(["load-session S1"]);
  });
  it("sign out → sign in as ANOTHER seller: the previous seller's session id / read never count", async () => {
    db.sessionRow = { current_session_id: "S-OLD", session_started_at: "2026-10-01T01:00:00Z", session_window_days: 5 };
    const h = open();
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
    h.rerender({ authed: false, fix: false });  // signed out (gate off while signed out)
    await tick();
    db.sessionRow = { current_session_id: "S-NEW", session_started_at: "2026-10-04T01:00:00Z", session_window_days: 3 };
    db.delay.mount = 80; db.delay.window = 80; db.log = [];
    h.rerender({ authed: true, fix: true });     // the next seller signs in
    expect(h.result.current.sessionInstance.loaded).toBe(false);
    expect(h.result.current.sessionWindow.loaded).toBe(false);
    await tick(30);
    expect(db.log.some((l) => l === "load-session S-OLD")).toBe(false);
    await waitFor(() => expect(h.result.current.sessionInstance.currentSessionId).toBe("S-NEW"));
  });
});
