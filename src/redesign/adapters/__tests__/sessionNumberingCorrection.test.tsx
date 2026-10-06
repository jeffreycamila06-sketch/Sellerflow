// Session-numbering fix, part 2 — the CORRECTION RELOAD (gate on only). When the real
// session id becomes known and differs from what the board was hydrated from, the board is
// reloaded by that id even though it has orders, and merged: database rows are the truth,
// this device's not-yet-saved orders for that session are kept, a placed order never changes
// its printed number. Gate off → no correction (today's hydrate-on-empty guard).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { LiveOrder } from "../../../lib/orderTypes";

type Row = { buyer_number: number; handle: string; customer_name: string; platform: string; product: string; price: number; created_at: string; session_date: string; comment_msg_id: string | null; qty: number; auto_code: null };
const row = (n: number, handle: string, day = "2026-10-04", product = "100", price = 100, msg: string | null = null): Row =>
  ({ buyer_number: n, handle, customer_name: handle, platform: "TikTok", product, price, created_at: `${day}T0${n % 10}:00:00Z`, session_date: day, comment_msg_id: msg, qty: 1, auto_code: null });

const db = vi.hoisted(() => ({
  bySession: {} as Record<string, unknown[]>,
  day: [] as unknown[],
  current: null as string | null,   // seller_session_config.current_session_id
  running: null as string | null,   // what session_status() answers
  ordersFail: 0,
  log: [] as string[],
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-04" }));
vi.mock("../../../supabase", () => {
  const builder = (table: string) => {
    const f: Record<string, unknown> = {}; let sel = "";
    const q: Record<string, unknown> = {};
    for (const op of ["order", "range", "limit", "gte", "lte"]) q[op] = () => q;
    q.select = (s: string) => { sel = s; return q; };
    q.eq = (c: string, v: unknown) => { f[c] = v; return q; };
    const answer = async () => {
      if (table === "seller_session_config" && sel.includes("current_session_id")) return { data: { current_session_id: db.current, session_started_at: null, session_window_days: null }, error: null };
      if (table === "seller_session_config") return { data: { window_days: 1, window_start: null }, error: null };
      if (table === "live_session_orders") {
        db.log.push(f.session_id ? `load-session ${String(f.session_id)}` : "load-day");
        if (db.ordersFail > 0) { db.ordersFail--; return { data: null, error: { message: "net" } }; }
        return { data: f.session_id ? (db.bySession[String(f.session_id)] || []) : db.day, error: null };
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
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      from: (t: string) => builder(t),
      rpc: async () => ({ data: [{ running: !!db.running, session_id: db.running, session_platform: "TikTok" }], error: null }),
    },
  };
});

import { useSessionWindow } from "../useSessionWindow";
import { useSessionInstance } from "../useSessionInstance";
import { useLiveSession, mergeCorrectedSession } from "../useLiveSession";
import { buildOrderFromComment } from "../../../lib/orderLogic";

function useApp({ fix }: { fix: boolean }) {
  const sessionWindow = useSessionWindow(true, fix);
  const sessionInstance = useSessionInstance(true, fix);
  const liveSession = useLiveSession(true, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId, fix, sessionKnown: sessionInstance.known, windowKnown: sessionWindow.known });
  return { sessionInstance, liveSession };
}
const next = (getBuyers: () => ReturnType<ReturnType<typeof useLiveSession>["getBuyers"]>, handle: string) =>
  buildOrderFromComment({ handle, name: handle, comment: "mine", platform: "TikTok", time: "" } as never, getBuyers(), 100, new Date("2026-10-04T08:00:00Z"));
const lo = (bNum: number, handle: string, item = "100", total = 100): LiveOrder => ({ orderNum: 1, item, qty: 1, price: total, total, time: "", handle, name: handle, bNum, platform: "TikTok", status: "New", date: "2026-10-04" });

beforeEach(() => { db.bySession = {}; db.day = []; db.current = null; db.running = null; db.ordersFail = 0; db.log = []; });

describe("mergeCorrectedSession (pure)", () => {
  const rows = [row(1, "@a"), row(2, "@b"), row(3, "@c")];
  it("database rows are the truth; numbering continues from the session (next new = #4)", () => {
    const m = mergeCorrectedSession(rows, []);
    expect(m.buyers.map((b) => b.num)).toEqual([1, 2, 3]);
    expect(buildOrderFromComment({ handle: "@new", platform: "TikTok", comment: "", name: "", time: "" } as never, m.buyers, 100, new Date()).order.bNum).toBe(4);
  });
  it("an unsaved local order is kept with its PRINTED number; a saved one is not duplicated", () => {
    const m = mergeCorrectedSession(rows, [lo(2, "@b"), lo(4, "@d")]); // @b #2 is already a row; @d #4 is not saved yet
    expect(m.orders).toHaveLength(4);
    expect(m.orders.map((o) => [o.handle, o.bNum])).toEqual([["@a", 1], ["@b", 2], ["@c", 3], ["@d", 4]]);
    expect(m.buyers.find((b) => b.handle === "@d")?.num).toBe(4);
  });
  it("multiset: two identical local orders but one row → one kept", () => {
    const m = mergeCorrectedSession([row(1, "@a")], [lo(1, "@a"), lo(1, "@a")]);
    expect(m.orders).toHaveLength(2);
    expect(m.buyers[0]).toMatchObject({ num: 1, totalOrders: 2 });
  });
  it("a returning buyer keeps the session number; an unsaved order of theirs keeps its printed one", () => {
    const m = mergeCorrectedSession(rows, [lo(9, "@b")]); // printed #9 on a wrong board
    expect(m.buyers.find((b) => b.handle === "@b")?.num).toBe(2);           // the buyer's session number
    expect(m.orders.find((o) => o.bNum === 9)?.handle).toBe("@b");           // the placed order keeps #9
    expect(next(() => m.buyers, "@b").order.bNum).toBe(2);                   // the next @b order → #2
  });
});

describe("correction reload in the app (gate on)", () => {
  it("legacy board (no session) → a session started elsewhere is found at Connect → reload by it; numbering continues", async () => {
    db.day = [row(1, "@x"), row(2, "@y")];                                    // today's rows of an EARLIER session
    db.bySession.S1 = Array.from({ length: 70 }, (_, i) => row(i + 1, `@s${i + 1}`)); // the running session (other device)
    const h = renderHook(() => useApp({ fix: true }));
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(2)); // legacy board
    db.running = "S1";
    await act(async () => { await h.result.current.sessionInstance.checkStatus(); });  // Connect
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(70));
    expect(db.log).toContain("load-session S1");
    expect(h.result.current.liveSession.session.orders.some((o) => o.handle === "@x")).toBe(false); // the other session's rows are gone
    expect(next(h.result.current.liveSession.getBuyers, "@brand-new").order.bNum).toBe(71);
    expect(h.result.current.liveSession.canOrder()).toBe(true);
  });
  it("board of session S1 → the server's running session is S2 → reload S2; S1 orders made here are not carried over", async () => {
    db.current = "S1"; db.running = "S1";
    db.bySession.S1 = [row(1, "@a"), row(2, "@b")];
    db.bySession.S2 = [row(1, "@z")];
    const h = renderHook(() => useApp({ fix: true }));
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(2));
    const r = next(h.result.current.liveSession.getBuyers, "@c");             // an S1 order placed on this device (#3)
    act(() => { h.result.current.liveSession.applyOrder(r.nextBuyers, r.order); });
    db.running = "S2";
    await act(async () => { await h.result.current.sessionInstance.checkStatus(); });
    await waitFor(() => expect(db.log).toContain("load-session S2"));
    await waitFor(() => expect(h.result.current.liveSession.session.orders.map((o) => o.handle)).toEqual(["@z"]));
  });
  it("the correction load fails → the board stays, orders stay paused; the retry merges", async () => {
    db.day = [row(1, "@x")];
    db.bySession.S1 = [row(1, "@s1"), row(2, "@s2")];
    const h = renderHook(() => useApp({ fix: true }));
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(1));
    db.running = "S1"; db.ordersFail = 1;
    await act(async () => { await h.result.current.sessionInstance.checkStatus(); });
    await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("failed"));
    expect(h.result.current.liveSession.session.orders).toHaveLength(1);       // not blanked
    expect(h.result.current.liveSession.canOrder()).toBe(false);
    await act(async () => { h.result.current.liveSession.retry(); });
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(2));
    expect(h.result.current.liveSession.canOrder()).toBe(true);
  });
  it("gate OFF → no correction: the board keeps today's hydrate-on-empty behaviour", async () => {
    db.day = [row(1, "@x"), row(2, "@y")];
    db.bySession.S1 = Array.from({ length: 70 }, (_, i) => row(i + 1, `@s${i + 1}`));
    const h = renderHook(() => useApp({ fix: false }));
    await waitFor(() => expect(h.result.current.liveSession.session.orders).toHaveLength(2));
    db.running = "S1";
    await act(async () => { await h.result.current.sessionInstance.checkStatus(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(db.log).not.toContain("load-session S1");
    expect(next(h.result.current.liveSession.getBuyers, "@brand-new").order.bNum).toBe(3); // today's (wrong) behaviour, unchanged
  });
});
