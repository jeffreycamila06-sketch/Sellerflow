// Session-numbering fix — the production repro, run with the staged gate ON and OFF.
// Bug: inside ONE running multi-day session, buyer numbers restarted from "today's buyer
// count + 1". Gate ON (fix) → the correct #75 / returning #3. Gate OFF → today's code path,
// which still shows the bug (#6) — proving the gate really separates the two behaviours.
//
// Wiring mirrors RedesignApp exactly:
//   useSessionWindow(authed) · useSessionInstance(authed) ·
//   useLiveSession(authed, { ready: window.loaded && instance.loaded, windowDays, windowStart,
//                            sessionId: instance.currentSessionId })
// and the next buyer number comes from the real buildOrderFromComment(…, getBuyers(), …).
//
// Session S1 (5 days): days 1–3 have buyers #1…#69; TODAY 5 buyers already ordered
// (#70…#74). The correct next new buyer is #75 and a returning day-1 buyer keeps #3.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const TODAY = "2026-10-04";
type Row = { buyer_number: number; handle: string; customer_name: string; platform: string; product: string; price: number; created_at: string; session_date: string; comment_msg_id: null; qty: number; auto_code: null };
const row = (n: number, day: string, i: number): Row => ({ buyer_number: n, handle: `@b${n}`, customer_name: `B${n}`, platform: "TikTok", product: "100", price: 100, created_at: `${day}T0${i % 10}:00:00Z`, session_date: day, comment_msg_id: null, qty: 1, auto_code: null });
const EARLIER = Array.from({ length: 69 }, (_, i) => row(i + 1, i < 30 ? "2026-10-02" : "2026-10-03", i));
const TODAY_ROWS = [70, 71, 72, 73, 74].map((n, i) => row(n, TODAY, i));

const db = vi.hoisted(() => ({
  mountRead: null as null | (() => Promise<{ data: unknown; error: unknown }>), // seller_session_config current_session_id read
  log: [] as string[],
  dayDelayMs: 0, // > 0 = the day-only query answers slower than the session-id read (the race is WON)
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => TODAY }));
vi.mock("../../../supabase", () => {
  const builder = (table: string) => {
    const f: Record<string, unknown> = {};
    let sel = "";
    const q: Record<string, unknown> = {};
    for (const op of ["order", "range", "limit"]) q[op] = () => q;
    q.select = (s: string) => { sel = s; return q; };
    q.eq = (c: string, v: unknown) => { f[c] = v; return q; };
    q.gte = (c: string, v: unknown) => { f[`${c}>=`] = v; return q; };
    q.lte = (c: string, v: unknown) => { f[`${c}<=`] = v; return q; };
    const answer = async (): Promise<{ data: unknown; error: unknown }> => {
      if (table === "seller_session_config" && sel.includes("current_session_id")) { db.log.push("mount-read"); return db.mountRead ? db.mountRead() : { data: { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 }, error: null }; }
      if (table === "seller_session_config") return { data: { window_days: 1, window_start: null }, error: null }; // legacy window config: never written for session-model sellers
      if (table === "live_session_orders" && f.session_id) { db.log.push("load-by-session"); return { data: f.session_id === "S1" ? [...EARLIER, ...TODAY_ROWS] : [], error: null }; }
      if (table === "live_session_orders" && db.dayDelayMs) await new Promise((r) => setTimeout(r, db.dayDelayMs));
      if (table === "live_session_orders") { db.log.push(`load-day ${String(f["session_date>="])}`); return { data: TODAY_ROWS.filter((r) => r.session_date >= String(f["session_date>="]) && r.session_date <= String(f["session_date<="])), error: null }; }
      return { data: null, error: null };
    };
    q.maybeSingle = answer;
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => answer().then(ok, bad);
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      from: (t: string) => builder(t),
      rpc: async (name: string) => (name === "session_status" ? { data: [{ running: true, session_id: "S1", session_platform: "TikTok" }], error: null } : { data: null, error: null }),
    },
  };
});

import { useSessionWindow } from "../useSessionWindow";
import { useSessionInstance } from "../useSessionInstance";
import { useLiveSession } from "../useLiveSession";
import { buildOrderFromComment } from "../../../lib/orderLogic";

// Mirrors RedesignApp's wiring (fix = sessionNumberingGate(…) === "on").
function useApp({ authed, fix }: { authed: boolean; fix: boolean }) {
  const sessionWindow = useSessionWindow(authed, fix);
  const sessionInstance = useSessionInstance(authed, fix);
  const liveSession = useLiveSession(authed, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId, fix, sessionKnown: sessionInstance.known, windowKnown: sessionWindow.known });
  return { sessionInstance, liveSession };
}
const nextNumber = (getBuyers: () => ReturnType<ReturnType<typeof useLiveSession>["getBuyers"]>, handle: string) =>
  buildOrderFromComment({ handle, name: handle, comment: "mine", platform: "TikTok", time: "" } as never, getBuyers(), 100, new Date("2026-10-04T08:00:00Z")).order.bNum;

beforeEach(() => { db.mountRead = null; db.log = []; db.dayDelayMs = 0; });

let FIX = false;
async function openApp() {
  const h = renderHook((p: { authed: boolean; fix: boolean }) => useApp(p), { initialProps: { authed: false, fix: false } }); // auth still "loading" (gate "off" while signed out)
  h.rerender({ authed: true, fix: FIX });                                                                                    // signed in → gate decided
  return h;
}
async function connect(h: Awaited<ReturnType<typeof openApp>>) {
  // RedesignApp Connect: await ensureLoaded() → checkStatus() → running → connect (continue).
  await act(async () => { await h.result.current.sessionInstance.ensureLoaded(); await h.result.current.sessionInstance.checkStatus(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

for (const gate of ["on", "off"] as const) describe(`gate ${gate}: buyer numbering in a running session`, () => {
  beforeEach(() => { FIX = gate === "on"; });
  const NEW = gate === "on" ? 75 : 6;          // off = today's bug, unchanged
  const RETURNING = gate === "on" ? 3 : 6;
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  it("(a) slow current_session_id read → next new buyer / returning day-1 buyer", async () => {
    let release!: (v: { data: unknown; error: unknown }) => void;
    db.mountRead = () => new Promise((r) => { release = r; });
    const h = await openApp();
    if (gate === "off") await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(5)); // day-only board first
    else {
      await tick();
      expect(h.result.current.liveSession.session.orders).toHaveLength(0);      // nothing guessed while the read is out
      expect(h.result.current.liveSession.loadStatus).toBe("pending");
      expect(h.result.current.liveSession.canOrder()).toBe(false);
      expect(db.log.some((l) => l.startsWith("load-day"))).toBe(false);
    }
    await act(async () => { release({ data: { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 }, error: null }); });
    await connect(h);
    expect(h.result.current.sessionInstance.currentSessionId).toBe("S1");
    if (gate === "on") await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(74));
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(NEW);
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@b3")).toBe(RETURNING);
  });

  it("(b) the current_session_id read FAILS → after Connect", async () => {
    db.mountRead = async () => ({ data: null, error: { message: "Failed to fetch" } });
    const h = await openApp();
    if (gate === "off") await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(5));
    else {
      await tick();
      expect(h.result.current.sessionInstance.known).toBe(false);              // unknown, not "no session"
      expect(h.result.current.liveSession.loadStatus).toBe("unknown");
      expect(h.result.current.liveSession.canOrder()).toBe(false);
      expect(db.log.some((l) => l.startsWith("load-day"))).toBe(false);
    }
    await connect(h);                                                             // checkStatus succeeds → known S1
    expect(h.result.current.sessionInstance.currentSessionId).toBe("S1");
    if (gate === "on") await waitFor(() => expect(h.result.current.liveSession.canOrder()).toBe(true));
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(NEW);
  });

  it("(c) a fast, SUCCESSFUL read that the day query used to beat", async () => {
    const h = await openApp();
    await waitFor(() => expect(h.result.current.sessionInstance.currentSessionId).toBe("S1"));
    await tick();
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(NEW);
    if (gate === "on") expect(db.log.some((l) => l.startsWith("load-day"))).toBe(false); // never a day-only load
  });

  it("control: the session-id read lands BEFORE the day query → #75 on both paths", async () => {
    db.dayDelayMs = 50;
    const h = await openApp();
    await waitFor(() => expect(h.result.current.liveSession.session.orders.length).toBeGreaterThan(5));
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(75);
  });
});
