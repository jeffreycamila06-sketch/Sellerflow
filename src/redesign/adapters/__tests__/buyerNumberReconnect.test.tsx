// 2026-10-11 bug: inside ONE multi-day session the selling device's board was hours old (it
// held the session's first 8 buyers; other buyers #9–#139 were numbered meanwhile). After a
// ~9-minute gap the platform reconnected, the board was NOT reloaded (hydrate-on-empty), and
// new buyers got #9, #10, #11… — numbers other buyers already owned. Fix: a reconnect reloads
// the session's buyers from the server (liveSession.resync) with orders paused until it lands,
// and the next number is the highest number + 1 (not the buyer count + 1).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = { buyer_number: number; handle: string; customer_name: string; platform: string; product: string; price: number; created_at: string; session_date: string; comment_msg_id: null; qty: number; auto_code: null };
const row = (n: number, handle = `@b${n}`, day = "2026-10-09"): Row =>
  ({ buyer_number: n, handle, customer_name: handle, platform: "TikTok", product: "100", price: 100, created_at: `${day}T01:00:00Z`, session_date: day, comment_msg_id: null, qty: 1, auto_code: null });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

const db = vi.hoisted(() => ({ bySession: {} as Record<string, unknown[]>, ordersFail: 0, loads: 0 }));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-09" }));
vi.mock("../../../supabase", () => {
  const builder = (table: string) => {
    const f: Record<string, unknown> = {}; let sel = "";
    const q: Record<string, unknown> = {};
    for (const op of ["order", "range", "limit", "gte", "lte"]) q[op] = () => q;
    q.select = (s: string) => { sel = s; return q; };
    q.eq = (c: string, v: unknown) => { f[c] = v; return q; };
    const answer = async () => {
      if (table === "seller_session_config" && sel.includes("current_session_id")) return { data: { current_session_id: "S1", session_started_at: null, session_window_days: null }, error: null };
      if (table === "seller_session_config") return { data: { window_days: 3, window_start: null }, error: null };
      if (table === "live_session_orders") {
        db.loads++;
        if (db.ordersFail > 0) { db.ordersFail--; return { data: null, error: { message: "net" } }; }
        return { data: db.bySession[String(f.session_id)] || [], error: null };
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
      rpc: async () => ({ data: [{ running: true, session_id: "S1", session_platform: "TikTok" }], error: null }),
    },
  };
});

import { useSessionWindow } from "../useSessionWindow";
import { useSessionInstance } from "../useSessionInstance";
import { useLiveSession, RESYNC_FRESH_MS } from "../useLiveSession";
import { buildOrderFromComment, nextBuyerNumber } from "../../../lib/orderLogic";

function useApp(fix = true) {
  const sessionWindow = useSessionWindow(true, fix);
  const sessionInstance = useSessionInstance(true, fix);
  return useLiveSession(true, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId, fix, sessionKnown: sessionInstance.known, windowKnown: sessionWindow.known });
}
type LS = ReturnType<typeof useLiveSession>;
// Exactly what useOrders.createOrder does: buildOrderFromComment(c, getBuyers(), …).
const numberFor = (ls: LS, handle: string) =>
  buildOrderFromComment({ handle, name: handle, comment: "mine", platform: "TikTok", time: "" } as never, ls.getBuyers(), 100, new Date()).order.bNum;

// Open the app at 09:33 (board = the session's first 8 buyers), then other buyers are
// numbered up to #139 while this board sits unchanged, then time passes.
async function staleBoard(fix = true) {
  db.bySession.S1 = range(1, 8);
  const h = renderHook(() => useApp(fix));
  await waitFor(() => expect(h.result.current.getBuyers()).toHaveLength(8));
  db.bySession.S1 = range(1, 139);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60 * 1000);
  return h;
}

beforeEach(() => { db.bySession = {}; db.ordersFail = 0; db.loads = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe("nextBuyerNumber", () => {
  it("is the highest number + 1, not the buyer count + 1", () => {
    expect(nextBuyerNumber([])).toBe(1);
    expect(nextBuyerNumber([{ num: 1 }, { num: 2 }, { num: 5 }] as never)).toBe(6); // #3, #4 missing from the board
  });
});

describe("reconnect inside a multi-day session (139 buyers on the server)", () => {
  it("without a reload the stale board would hand out #9 (the bug)", async () => {
    const { result } = await staleBoard();
    expect(numberFor(result.current, "@new")).toBe(9);
  });

  it("reconnect → orders pause, then a new buyer gets #140 and returning buyers keep their numbers", async () => {
    const { result } = await staleBoard();
    act(() => { result.current.resync(); });
    expect(result.current.canOrder()).toBe(false); // closed in the same tick — nothing numbered from the old board
    await waitFor(() => expect(result.current.canOrder()).toBe(true));
    expect(numberFor(result.current, "@new")).toBe(140);
    expect(numberFor(result.current, "@b50")).toBe(50); // numbered on another device — keeps #50, no 2nd number
    expect(numberFor(result.current, "@b2")).toBe(2);   // was on this board — keeps #2
    expect(result.current.getBuyers()).toHaveLength(139);
  });

  it("an order this device placed but has not saved yet survives the reload", async () => {
    const { result } = await staleBoard();
    const { order, nextBuyers } = buildOrderFromComment({ handle: "@local", name: "@local", comment: "", platform: "TikTok", time: "" } as never, result.current.getBuyers(), 100, new Date());
    act(() => { result.current.applyOrder(nextBuyers, order); });
    act(() => { result.current.resync(); });
    await waitFor(() => expect(result.current.canOrder()).toBe(true));
    expect(result.current.session.orders).toHaveLength(140);
    expect(result.current.getBuyers().find((b) => b.handle === "@local")?.num).toBe(order.bNum);
  });

  it("buyers can't be loaded on reconnect → orders stay paused (load_failed), then the retry reloads", async () => {
    const { result } = await staleBoard();
    db.ordersFail = 1;
    act(() => { result.current.resync(); });
    await waitFor(() => expect(result.current.loadStatus).toBe("failed"));
    expect(result.current.canOrder()).toBe(false);
    expect(result.current.pauseReason).toBe("load_failed"); // RedesignApp shows "Couldn't load this session's buyers…"
    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.canOrder()).toBe(true));
    expect(numberFor(result.current, "@new")).toBe(140);
  });

  it("a board loaded moments ago is not reloaded again (app open → Connect)", async () => {
    db.bySession.S1 = range(1, 8);
    const { result } = renderHook(() => useApp());
    await waitFor(() => expect(result.current.getBuyers()).toHaveLength(8));
    const loads = db.loads;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + RESYNC_FRESH_MS - 1000);
    act(() => { result.current.resync(); });
    expect(result.current.canOrder()).toBe(true);
    expect(db.loads).toBe(loads);
  });

  it("numbering gate off → resync does nothing (today's path)", async () => {
    const { result } = await staleBoard(false);
    const loads = db.loads;
    act(() => { result.current.resync(); });
    expect(db.loads).toBe(loads);
  });
});

describe("RedesignApp wiring", () => {
  const src = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
  it("a live platform going from not connected to connected calls liveSession.resync", () => {
    expect(src).toMatch(/const anyPlatformLive = liveFeed\.ttConnected \|\| liveFeed\.fbConnected \|\| liveFeed\.shopeeConnected \|\| liveFeed\.igConnected;/);
    expect(src).toMatch(/const resyncSession = liveSession\.resync;/);
    expect(src).toMatch(/if \(anyPlatformLive && !was\) resyncSession\(\);/);
  });
  it("orders still go through the session gate and the pause notice", () => {
    expect(src).toMatch(/canOrder: liveSession\.canOrder/);
    expect(src).toMatch(/liveSession\.loadStatus === "failed" \|\| liveSession\.loadStatus === "unknown"/);
  });
});
