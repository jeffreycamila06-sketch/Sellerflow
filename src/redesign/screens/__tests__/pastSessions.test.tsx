// FIX 4 — past-session picker on Orders (tiktokSend testers). READ-ONLY, separate state: a
// picked past session feeds ONLY the numeric buyer-# card (+ Send). Current = as before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const S = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; filters: Record<string, unknown> }[],
  index: [] as unknown[],
  bySession: {} as Record<string, unknown[]>,
}));
function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const q = {
    select: (cols: string) => { filters.select = cols; S.calls.push({ table, op: "select", filters }); return q; },
    eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    not: (k: string) => { filters[`not_${k}`] = true; return q; },
    order: () => q,
    range: async () => ({
      data: filters.session_id ? (S.bySession[String(filters.session_id)] || []) : S.index,
      error: null,
    }),
    insert: () => { S.calls.push({ table, op: "insert", filters }); return q; },
    update: () => { S.calls.push({ table, op: "update", filters }); return q; },
    upsert: () => { S.calls.push({ table, op: "upsert", filters }); return q; },
    delete: () => { S.calls.push({ table, op: "delete", filters }); return q; },
  };
  return q;
}
// my_session_summaries() (sql/128): the same grouping the database does, from S.index.
function summaries() {
  const by = new Map<string, { session_id: string; first_day: string; last_day: string; orders: number; latest: string }>();
  for (const r of S.index as { session_id: string; session_date: string; created_at: string }[]) {
    const s = by.get(r.session_id);
    if (!s) { by.set(r.session_id, { session_id: r.session_id, first_day: r.session_date, last_day: r.session_date, orders: 1, latest: r.created_at }); continue; }
    if (r.session_date < s.first_day) s.first_day = r.session_date;
    if (r.session_date > s.last_day) s.last_day = r.session_date;
    if (r.created_at > s.latest) s.latest = r.created_at;
    s.orders += 1;
  }
  return [...by.values()];
}
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t: string) => builder(t), rpc: async (fn: string) => { S.calls.push({ table: `rpc:${fn}`, op: "rpc", filters: {} }); return { data: summaries(), error: null }; }, auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
}));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import { buildSessionIndex, sessionRange, summariesFromRpc } from "../../adapters/pastSessions";
import type { Buyer } from "../../../lib/orderTypes";

const CUR = "cur-session", OLD = "old-session", OLDER = "older-session";
const row = (sid: string, day: string, n: number, handle: string, name: string, product: string, price: number, qty = 1) =>
  ({ session_id: sid, session_date: day, created_at: `${day}T05:00:00.000Z`, buyer_number: n, handle, customer_name: name, platform: "TikTok", product, price, qty, comment_msg_id: null, auto_code: null });
const todayBuyer: Buyer = { handle: "@todaybuyer", name: "Today Buyer", platform: "TikTok", num: 1, totalSpent: 99, totalOrders: 1,
  orders: [{ item: "Today item", total: 99, qty: 1, orderNum: Date.UTC(2026, 9, 14, 5) }] as never };

beforeEach(() => {
  S.calls = [];
  const old = [row(OLD, "2026-10-08", 1, "@oldbuyer", "Old Buyer", "A12 Pink blouse", 250, 3), row(OLD, "2026-10-10", 2, "@x", "X", "B", 100)];
  const older = [row(OLDER, "2026-10-01", 1, "@olderbuyer", "Older Buyer", "C", 50)];
  const cur = [row(CUR, "2026-10-14", 1, "@todaybuyer", "Today Buyer", "Today item", 99)];
  S.index = [...older, ...old, ...cur].map(({ session_id, session_date, created_at }) => ({ session_id, session_date, created_at }));
  S.bySession = { [OLD]: old, [OLDER]: older, [CUR]: cur };
});

const renderOrders = (tiktokSend: boolean) => {
  const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[todayBuyer]} todayId="2026-10-14" sessionId={CUR} tiktokSend={tiktokSend} sellerId="me" /></TProvider>);
  const search = r.container.querySelectorAll("input")[0] as HTMLInputElement;
  return { ...r, type: (v: string) => fireEvent.change(search, { target: { value: v } }) };
};
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

describe("buildSessionIndex (pure)", () => {
  it("groups by session_id, newest first, day span + order count, marks current", () => {
    const idx = buildSessionIndex(S.index as never, CUR);
    expect(idx.map((s) => s.id)).toEqual([CUR, OLD, OLDER]);
    expect(idx[1]).toMatchObject({ first: "2026-10-08", last: "2026-10-10", days: 3, orders: 2, current: false });
    expect(idx[0].current).toBe(true);
    expect(sessionRange(idx[1])).toBe("10/08 → 10/10");
    expect(sessionRange(idx[2])).toBe("10/01");
  });
  it("A18 — the database summaries map to the same list as the old client grouping", () => {
    expect(summariesFromRpc(summaries() as never, CUR)).toEqual(buildSessionIndex(S.index as never, CUR));
  });
});

describe("the picker", () => {
  it("ungated → no past sessions in the menu, no reads", async () => {
    renderOrders(false);
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(q("ord-past-heading")).toBeNull();
    expect(S.calls).toEqual([]);
  });
  it("gated → the 🗓 menu lists the past sessions (newest first, current not repeated)", async () => {
    renderOrders(true);
    expect(q("ord-range")!.textContent).toBe("🗓 Sessions ▾");
    expect(S.calls).toEqual([]);                           // nothing read until the menu opens
    fireEvent.click(q("ord-range")!);
    await settle();
    const items = qa("ord-session-item").map((e) => e.textContent);
    expect(items).toEqual(["Past session · 10/08 → 10/10 · 3 days", "Past session · 10/01 · 1 dayMay be incomplete — older days were removed"]);
    expect(S.calls.map((c) => c.table)).toEqual(["rpc:my_session_summaries"]); // one small call, no row paging
  });
  it("past session: buyer #1 is THAT session's #1 (not today's), labelled with the session; Send carries the range + x3", async () => {
    const r = renderOrders(true);
    fireEvent.click(q("ord-range")!);
    await settle();
    fireEvent.click(qa("ord-session-item")[0]);
    await settle();
    r.type("1");
    const box = q("buyer-receipt")!;
    expect(box.textContent).toContain("Old Buyer");
    expect(box.textContent).not.toContain("Today Buyer");
    expect(q("receipt-session")!.textContent).toBe("Session 10/08 → 10/10");
    fireEvent.click(q("tt-send-btn")!);
    const msg = q("tts-preview")!.textContent || "";
    expect(msg).toContain("Order mo sa live (10/08 → 10/10):");
    expect(msg).toContain("1. A12 Pink blouse x3 — NT$750");
    expect(q("tts-copy-open")).toBeNull();                 // an OLD session asks one confirm first
    fireEvent.click(q("tts-old-yes")!);
    await act(async () => { fireEvent.click(q("tts-copy-open")!); });
    expect(copyText.mock.calls[0][0]).toContain("Old Buyer");
  });
  it("switching back to Current = the original card (today's #1, no session label)", async () => {
    const r = renderOrders(true);
    r.type("1");
    const original = q("buyer-receipt")!.outerHTML;
    fireEvent.click(q("ord-range")!);
    await settle();
    fireEvent.click(qa("ord-session-item")[0]);
    await settle();
    expect(q("buyer-receipt")!.textContent).toContain("Old Buyer");
    fireEvent.click(q("ord-range")!);
    fireEvent.click(q("ord-range-session")!);
    await settle();
    expect(q("buyer-receipt")!.outerHTML).toBe(original);
    expect(q("receipt-session")).toBeNull();
  });
  it("read-only: the summaries RPC + selects on live_session_orders only (no insert / update / upsert / delete)", async () => {
    const r = renderOrders(true);
    fireEvent.click(q("ord-range")!);
    await settle();
    fireEvent.click(qa("ord-session-item")[1]);
    await settle();
    r.type("1");
    expect(q("buyer-receipt")!.textContent).toContain("Older Buyer");
    expect(S.calls.length).toBeGreaterThan(0);
    expect(S.calls.every((c) => (c.op === "rpc" && c.table === "rpc:my_session_summaries") || (c.op === "select" && c.table === "live_session_orders" && c.filters.user_id === "me"))).toBe(true);
  });
});

describe("separation (source contract)", () => {
  it("past-session data never reaches liveSession / numbering / Auto Mode / printing / Sales / shipping", () => {
    const src = readFileSync("src/redesign/adapters/pastSessions.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/useLiveSession|applyOrder|createOrder|useOrders|printSlip|printing|salesTab|shipping|insert\(|update\(|upsert\(|delete\(/);
    // RedesignApp passes the GATE boolean only (pastSessionsAllowed) — never the data; everything
    // else that mentions pastSessions lives in Orders.
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8")
      .replace('import { pastSessionsAllowed } from "./adapters/pastSessions";', "")
      .replace('pastSessions={pastSessionsAllowed(isAdmin, hasFeature("tiktok_send"), featureSw.pastSessionsPublic)}', "");
    expect(app).not.toMatch(/pastSessions/);                       // only Orders uses it
  });
});
