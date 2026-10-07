// Session-numbering fix — PAUSE LOG. One row per pause (fire-and-forget), counts + timings only.
// Integration: with the insert OK / rejecting / throwing / never resolving, orders, buyer
// numbering and printing behave exactly the same as with no logger at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Res = { data: unknown; error: unknown };
const db = vi.hoisted(() => ({
  ordersFail: 0, insertMode: "ok" as "ok" | "reject" | "throw" | "never",
  inserts: [] as Record<string, unknown>[],
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-07" }));
vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => ({ ok: true })), saveLiveSessionOrder: vi.fn(async () => ({ ok: true })), saveCustomerToDatabase: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../productsDb", () => ({ decrementStockAndTouch: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../../supabase", () => {
  const builder = (table: string) => {
    const f: Record<string, unknown> = {}; let sel = "";
    const q: Record<string, unknown> = {};
    for (const op of ["order", "range", "limit", "gte", "lte"]) q[op] = () => q;
    q.select = (s: string) => { sel = s; return q; };
    q.eq = (c: string, v: unknown) => { f[c] = v; return q; };
    q.insert = (row: Record<string, unknown>) => {
      db.inserts.push(row);
      if (db.insertMode === "throw") throw new Error("insert threw");
      if (db.insertMode === "reject") return Promise.reject(new Error("insert rejected"));
      if (db.insertMode === "never") return new Promise(() => {});
      return Promise.resolve({ data: null, error: null });
    };
    const answer = async (): Promise<Res> => {
      if (table === "seller_session_config" && sel.includes("current_session_id")) return { data: { current_session_id: "s1", session_started_at: "2026-10-07T00:00:00Z", session_window_days: 1 }, error: null };
      if (table === "seller_session_config") return { data: { window_days: 1, window_start: null }, error: null };
      if (table === "live_session_orders") {
        if (db.ordersFail > 0) { db.ordersFail--; return { data: null, error: { message: "net" } }; }
        return { data: [{ buyer_number: 1, handle: "@a", customer_name: "A", platform: "TikTok", product: "100", price: 100, created_at: "2026-10-07T01:00:00Z", session_date: "2026-10-07", comment_msg_id: null, qty: 1, auto_code: null, session_id: "s1" }], error: null };
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
      rpc: async () => ({ data: [{ running: true, session_id: "s1", session_platform: "TikTok" }], error: null }),
    },
  };
});

import { useSessionWindow } from "../useSessionWindow";
import { useSessionInstance } from "../useSessionInstance";
import { useLiveSession, pauseReasonOf } from "../useLiveSession";
import { useOrders } from "../useOrders";
import { useSessionPauseLog, shouldLogPause, longestReason, buildPauseRow, writePauseRow, PAUSE_STILL_MS, type SessionPauseRow } from "../sessionPauseLog";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const tick = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const cm = (id: string, handle: string, text: string): ProdComment => ({ id, name: `Name ${id}`, handle, comment: text, platform: "TikTok", timestamp: 1 } as unknown as ProdComment);
type Feed = { id: string; text: string }[];
const printedNums: number[] = [];

function useApp({ logger, feed }: { logger: boolean; feed: Feed }) {
  const sessionWindow = useSessionWindow(true, true);
  const sessionInstance = useSessionInstance(true, true);
  const liveSession = useLiveSession(true, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId, fix: true, sessionKnown: sessionInstance.known, windowKnown: sessionWindow.known });
  const orders = useOrders({ getBuyers: liveSession.getBuyers, applyOrder: liveSession.applyOrder, sessionDate: "2026-10-07", sessionId: sessionInstance.currentSessionId, canOrder: liveSession.canOrder, onOrderBlocked: () => {}, onPrint: ((b: { num: number }) => { printedNums.push(b.num); }) as never });
  if (logger) useSessionPauseLog({ reason: liveSession.pauseReason, autoOn: true, feed, wouldBeOrder: (t) => /^A1$/i.test(t.trim()) }); // eslint-disable-line react-hooks/rules-of-hooks
  return { liveSession, orders };
}

async function scenario(logger: boolean) {
  db.ordersFail = 1; db.inserts = []; printedNums.length = 0;
  const h = renderHook((p: { feed: Feed }) => useApp({ logger, feed: p.feed }), { initialProps: { feed: [] as Feed } });
  await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("failed"));
  // paused: an order is refused, comments arrive (one matches the Auto code A1)
  const blocked = h.result.current.orders.createOrder(cm("c1", "@b", "A1"), 150);
  h.rerender({ feed: [{ id: "c1", text: "A1" }] });
  h.rerender({ feed: [{ id: "c2", text: "how much po" }, { id: "c1", text: "A1" }] });
  await tick(1100); // the pause lasts > 1 s
  act(() => { h.result.current.liveSession.retry(); });
  await waitFor(() => expect(h.result.current.liveSession.loadStatus).toBe("ok"));
  let made: ReturnType<typeof h.result.current.orders.createOrder> = null;
  act(() => { made = h.result.current.orders.createOrder(cm("c3", "@b", "A1"), 150); });
  await tick();
  return { blocked, bNum: (made as { bNum?: number } | null)?.bNum ?? null, prints: [...printedNums], buyers: h.result.current.liveSession.getBuyers().map((b) => `${b.handle}#${b.num}`), unmount: h.unmount };
}

beforeEach(() => { db.insertMode = "ok"; db.inserts = []; db.ordersFail = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("pure helpers", () => {
  it("a sub-second pause with no comments is not logged; 1 s+ or any comment is", () => {
    expect(shouldLogPause(999, 0)).toBe(false);
    expect(shouldLogPause(1000, 0)).toBe(true);
    expect(shouldLogPause(10, 1)).toBe(true);
  });
  it("the reason = the condition that held longest", () => {
    expect(longestReason({ settings_loading: 300, board_loading: 900 }, "settings_loading")).toBe("board_loading");
    expect(longestReason({}, "load_failed")).toBe("load_failed");
  });
  it("pause reasons map the real conditions", () => {
    expect(pauseReasonOf("ok", true, true, "load")).toBeNull();
    expect(pauseReasonOf("pending", false, undefined, "load")).toBe("settings_loading");
    expect(pauseReasonOf("unknown", true, false, "load")).toBe("session_unknown");
    expect(pauseReasonOf("unknown", true, true, "load")).toBe("window_unknown");
    expect(pauseReasonOf("pending", true, true, "load")).toBe("board_loading");
    expect(pauseReasonOf("pending", true, true, "correction")).toBe("correcting");
    expect(pauseReasonOf("failed", true, true, "load")).toBe("load_failed");
  });
  it("the row holds ONLY counts/timings — never comment text, names, handles, ids, tokens or URLs", () => {
    const row = buildPauseRow({ reason: "load_failed", pausedMs: 1234.4, comments: 2, wouldBe: 1, autoOn: true, surface: "web", still: false });
    expect(Object.keys(row).sort()).toEqual(["auto_on", "comments_during", "paused_ms", "reason", "still_paused", "surface", "would_be_orders"]);
    expect(row.paused_ms).toBe(1234);
    for (const v of Object.values(row)) expect(typeof v === "string" ? /^[a-z_]+$/.test(v) : true).toBe(true);
  });
  it("writePauseRow returns at once and swallows a throw, a rejection and a never-settling insert", async () => {
    expect(() => writePauseRow(buildPauseRow({ reason: "load_failed", pausedMs: 1, comments: 0, wouldBe: 0, autoOn: false, surface: "web", still: false }), () => { throw new Error("x"); })).not.toThrow();
    expect(() => writePauseRow(buildPauseRow({ reason: "load_failed", pausedMs: 1, comments: 0, wouldBe: 0, autoOn: false, surface: "web", still: false }), () => Promise.reject(new Error("x")))).not.toThrow();
    expect(() => writePauseRow(buildPauseRow({ reason: "load_failed", pausedMs: 1, comments: 0, wouldBe: 0, autoOn: false, surface: "web", still: false }), () => new Promise(() => {}))).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("the hook (timers)", () => {
  const run = (initial: { reason: null | "load_failed"; feed: Feed; autoOn?: boolean }) => {
    let t = 0; const rows: SessionPauseRow[] = [];
    const h = renderHook((p: { reason: null | "load_failed"; feed: Feed; autoOn?: boolean }) => useSessionPauseLog({ reason: p.reason, autoOn: !!p.autoOn, feed: p.feed, wouldBeOrder: (x) => x === "A1", insert: async (r) => { rows.push(r); }, now: () => t }), { initialProps: initial });
    return { h, rows, at: (ms: number) => { t = ms; } };
  };
  it("a pause with comments writes ONE row with the right counts", async () => {
    const r = run({ reason: null, feed: [] });
    r.at(0); r.h.rerender({ reason: "load_failed", feed: [] });
    r.h.rerender({ reason: "load_failed", feed: [{ id: "1", text: "A1" }, { id: "2", text: "hi" }] });
    r.h.rerender({ reason: "load_failed", feed: [{ id: "3", text: "a1" }, { id: "1", text: "A1" }, { id: "2", text: "hi" }], autoOn: true });
    r.at(400); r.h.rerender({ reason: null, feed: [{ id: "3", text: "a1" }, { id: "1", text: "A1" }, { id: "2", text: "hi" }] });
    await new Promise((res) => setTimeout(res, 10));
    expect(r.rows).toEqual([{ reason: "load_failed", paused_ms: 400, comments_during: 3, would_be_orders: 1, auto_on: true, surface: "web", still_paused: false }]);
  });
  it("a sub-second pause with no comments writes nothing", async () => {
    const r = run({ reason: null, feed: [{ id: "1", text: "x" }] });
    r.at(0); r.h.rerender({ reason: "load_failed", feed: [{ id: "1", text: "x" }] });
    r.at(900); r.h.rerender({ reason: null, feed: [{ id: "1", text: "x" }] });
    await new Promise((res) => setTimeout(res, 10));
    expect(r.rows).toEqual([]);
  });
  it("comments already on screen when the pause starts are not counted", async () => {
    const r = run({ reason: null, feed: [{ id: "1", text: "A1" }] });
    r.at(0); r.h.rerender({ reason: "load_failed", feed: [{ id: "1", text: "A1" }] });
    r.at(1500); r.h.rerender({ reason: null, feed: [{ id: "1", text: "A1" }] });
    await new Promise((res) => setTimeout(res, 10));
    expect(r.rows).toEqual([expect.objectContaining({ paused_ms: 1500, comments_during: 0, would_be_orders: 0 })]);
  });
  it("still paused after 60 s → one 'still paused' row then, and the final row when it ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = run({ reason: null, feed: [] });
    r.at(0); r.h.rerender({ reason: "load_failed", feed: [] });
    r.at(PAUSE_STILL_MS); act(() => { vi.advanceTimersByTime(PAUSE_STILL_MS); });
    r.at(90_000); act(() => { vi.advanceTimersByTime(30_000); });
    r.h.rerender({ reason: null, feed: [] });
    vi.useRealTimers(); await new Promise((res) => setTimeout(res, 10));
    expect(r.rows).toEqual([
      expect.objectContaining({ still_paused: true, paused_ms: 60_000 }),
      expect.objectContaining({ still_paused: false, paused_ms: 90_000 }),
    ]);
  });
});

describe("integration: the log never changes orders, numbering or printing", () => {
  it("baseline (no logger) vs insert ok / rejecting / throwing / never resolving → identical", async () => {
    const base = await scenario(false); base.unmount();
    expect(base.blocked).toBeNull();
    expect(base.bNum).toBe(2);
    expect(base.prints).toEqual([2]);
    for (const mode of ["ok", "reject", "throw", "never"] as const) {
      db.insertMode = mode;
      const r = await scenario(true); r.unmount();
      expect({ blocked: r.blocked, bNum: r.bNum, prints: r.prints, buyers: r.buyers }, mode).toEqual({ blocked: base.blocked, bNum: base.bNum, prints: base.prints, buyers: base.buyers });
    }
  }, 30000);
  it("the pause is logged once with the right reason and counts — and no text, names or handles", async () => {
    const r = await scenario(true); r.unmount();
    await tick();
    const rows = db.inserts.filter((x) => x.reason === "load_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "load_failed", comments_during: 2, would_be_orders: 1, auto_on: true, surface: "web", still_paused: false });
    expect(rows[0].paused_ms as number).toBeGreaterThanOrEqual(1000);
    const json = JSON.stringify(db.inserts);
    for (const s of ["A1", "how much", "@b", "@a", "Name ", "u1", "s1", "http"]) expect(json).not.toContain(s);
  });
});
