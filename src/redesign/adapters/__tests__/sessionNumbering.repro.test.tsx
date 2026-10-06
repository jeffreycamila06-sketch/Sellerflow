// REPRO (plan only — this test is EXPECTED TO FAIL on main): inside ONE running multi-day
// session, buyer numbers restart from "today's buyer count + 1".
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

function useApp({ authed }: { authed: boolean }) {
  const sessionWindow = useSessionWindow(authed);
  const sessionInstance = useSessionInstance(authed);
  const liveSession = useLiveSession(authed, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId });
  return { sessionInstance, liveSession };
}
const nextNumber = (getBuyers: () => ReturnType<ReturnType<typeof useLiveSession>["getBuyers"]>, handle: string) =>
  buildOrderFromComment({ handle, name: handle, comment: "mine", platform: "TikTok", time: "" } as never, getBuyers(), 100, new Date("2026-10-04T08:00:00Z")).order.bNum;

beforeEach(() => { db.mountRead = null; db.log = []; db.dayDelayMs = 0; });

async function openApp() {
  const h = renderHook((p: { authed: boolean }) => useApp(p), { initialProps: { authed: false } }); // auth still "loading"
  h.rerender({ authed: true });                                                                     // signed in
  return h;
}
async function connect(h: Awaited<ReturnType<typeof openApp>>) {
  // RedesignApp Connect: await ensureLoaded() → checkStatus() → running → connect (continue).
  await act(async () => { await h.result.current.sessionInstance.ensureLoaded(); await h.result.current.sessionInstance.checkStatus(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("REPRO — buyer numbers restart mid-session", () => {
  it("(a) startup race: the day-only load wins over a slow current_session_id read → next new buyer is #6, not #75", async () => {
    let release!: (v: { data: unknown; error: unknown }) => void;
    db.mountRead = () => new Promise((r) => { release = r; });                 // the mount read is slow
    const h = await openApp();
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(5)); // day-only board hydrated first
    await act(async () => { release({ data: { current_session_id: "S1", session_started_at: "2026-10-02T01:00:00Z", session_window_days: 5 }, error: null }); });
    await connect(h);
    expect(h.result.current.sessionInstance.currentSessionId).toBe("S1");     // new orders WILL be stamped S1 …
    expect(db.log).toContain("load-day 2026-10-04");
    // … but the board is still today-only, so numbering restarts:
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(75); // FAILS: 6
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@b3")).toBe(3);         // FAILS: returning day-1 buyer gets 6
  });

  it("(b) the current_session_id read FAILS → treated as 'no session' → day-only board → #6 after Connect", async () => {
    db.mountRead = async () => ({ data: null, error: { message: "Failed to fetch" } });
    const h = await openApp();
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(5));
    await connect(h);
    expect(h.result.current.sessionInstance.currentSessionId).toBe("S1");
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(75); // FAILS: 6
  });

  it("(c) even a fast, SUCCESSFUL read loses when the day query answers first (no error needed) → #6", async () => {
    const h = await openApp();
    await waitFor(() => expect(h.result.current.sessionInstance.currentSessionId).toBe("S1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(75); // FAILS: 6
  });

  it("control (passes on main): the session-id read lands BEFORE the day query → loads by session_id → #75", async () => {
    db.dayDelayMs = 50;
    const h = await openApp();
    await waitFor(() => expect(h.result.current.liveSession.session.orders.length).toBeGreaterThan(5));
    expect(nextNumber(h.result.current.liveSession.getBuyers, "@brand-new")).toBe(75);
  });
});
