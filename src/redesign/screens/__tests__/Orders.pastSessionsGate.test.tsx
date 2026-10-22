// "Past sessions" picker for ALL sellers (claude/past-sessions-public) — the gate matrix and the
// decoupling from Send to TikTok:
//   picker  = admin OR "tiktok_send" list OR app_settings past_sessions_public = 'true' (any plan)
//   Send    = exactly as today (admin or the list, while tiktok_send_enabled is on) — never from the switch
// Plus: a 500+ order past session shows a loading state, then pages 150 rows with "Show more";
// the menu scrolls (max-height + overflow) and fits a 360 px phone (min-width 250).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const S = vi.hoisted(() => ({ index: [] as unknown[], bySession: {} as Record<string, unknown[]>, rpcCalls: 0 }));
function builder() {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, not: () => q, order: () => q,
    range: async (from: number, to: number) => ({ data: filters.session_id ? (S.bySession[String(filters.session_id)] || []).slice(from, to + 1) : S.index, error: null }),
  };
  return q;
}
function summaries() {
  const by = new Map<string, { session_id: string; first_day: string; last_day: string; orders: number; latest: string }>();
  for (const r of S.index as { session_id: string; session_date: string; created_at: string }[]) {
    const s = by.get(r.session_id);
    if (!s) { by.set(r.session_id, { session_id: r.session_id, first_day: r.session_date, last_day: r.session_date, orders: 1, latest: r.created_at }); continue; }
    if (r.created_at > s.latest) s.latest = r.created_at;
    s.orders += 1;
  }
  return [...by.values()];
}
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => builder(), rpc: async () => { S.rpcCalls++; return { data: summaries(), error: null }; }, auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
}));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import { pastSessionsAllowed } from "../../adapters/pastSessions";
import { tiktokSendAllowed } from "../../adapters/tiktokSend";
import { FEATURE_SWITCH_KEYS, SWITCHES_OFF, parseSwitches } from "../../adapters/featureSwitches";
import type { Buyer } from "../../../lib/orderTypes";

const CUR = "cur-session", OLD = "old-session", BIG = "big-session";
const row = (sid: string, day: string, n: number, i: number) =>
  ({ id: 1000 * (sid === BIG ? 2 : 1) + i, session_id: sid, session_date: day, created_at: `${day}T05:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, buyer_number: n, handle: `@b${n}`, customer_name: `Buyer ${n}`, platform: "TikTok", product: `Item ${i}`, price: 100, qty: 1, comment_msg_id: null, auto_code: null });
const todayBuyer: Buyer = { handle: "@todaybuyer", name: "Today Buyer", platform: "TikTok", num: 1, totalSpent: 99, totalOrders: 1, orders: [{ item: "Today item", total: 99, qty: 1, orderNum: Date.UTC(2026, 9, 22, 5) }] as never };

beforeEach(() => {
  S.rpcCalls = 0;
  const old = [row(OLD, "2026-10-08", 1, 0), row(OLD, "2026-10-08", 2, 1)];
  const big = Array.from({ length: 600 }, (_, i) => row(BIG, "2026-10-15", 1 + (i % 120), i)); // 600 orders, 120 buyers
  const cur = [row(CUR, "2026-10-22", 1, 0)];
  S.index = [...big, ...old, ...cur].map(({ session_id, session_date, created_at }) => ({ session_id, session_date, created_at }));
  S.bySession = { [OLD]: old, [BIG]: big, [CUR]: cur };
});
const renderOrders = (p: { pastSessions?: boolean; tiktokSend?: boolean }) => {
  const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[todayBuyer]} todayId="2026-10-22" sessionId={CUR} sellerId="me" pastSessions={!!p.pastSessions} tiktokSend={!!p.tiktokSend} /></TProvider>);
  const search = r.container.querySelectorAll("input")[0] as HTMLInputElement;
  return { ...r, type: (v: string) => fireEvent.change(search, { target: { value: v } }) };
};
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

describe("gate matrix (pure)", () => {
  it("picker: admin / list / switch — any one is enough; nothing = off", () => {
    expect(pastSessionsAllowed(false, false, false)).toBe(false);
    expect(pastSessionsAllowed(true, false, false)).toBe(true);   // admin
    expect(pastSessionsAllowed(false, true, false)).toBe(true);   // tiktok_send list
    expect(pastSessionsAllowed(false, false, true)).toBe(true);   // switch on → any seller, any plan
  });
  it("Send is untouched: the switch never grants it; it still needs admin/list AND tiktok_send_enabled", () => {
    expect(tiktokSendAllowed(false, false, true)).toBe(false);    // switch-only seller: no Send
    expect(tiktokSendAllowed(false, true, true)).toBe(true);
    expect(tiktokSendAllowed(true, false, false)).toBe(false);    // tiktok_send_enabled off hides Send even for admins (as before)
    expect(tiktokSendAllowed.length).toBe(3);
  });
  it("the switch key reads from app_settings like every other switch (fail closed)", () => {
    expect(FEATURE_SWITCH_KEYS.pastSessionsPublic).toBe("past_sessions_public");
    expect(SWITCHES_OFF.pastSessionsPublic).toBe(false);
    expect(parseSwitches([{ key: "past_sessions_public", value: "true" }]).pastSessionsPublic).toBe(true);
    expect(parseSwitches([{ key: "past_sessions_public", value: "TRUE" }]).pastSessionsPublic).toBe(false);
    expect(parseSwitches([]).pastSessionsPublic).toBe(false);
    const sql = readFileSync("sql/134_past_sessions_switch.sql", "utf8");
    expect(sql).toContain("('past_sessions_public', 'false')");
    expect(sql).toContain("on conflict (key) do nothing");
    expect(readFileSync("sql/134_past_sessions_switch_rollback.sql", "utf8")).toContain("where key = 'past_sessions_public'");
  });
  it("RedesignApp wires the two gates separately (source pin)", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain('tiktokSend={tiktokSendAllowed(isAdmin, hasFeature("tiktok_send"), featureSw.tiktokSend)}');
    expect(app).toContain('pastSessions={pastSessionsAllowed(isAdmin, hasFeature("tiktok_send"), featureSw.pastSessionsPublic)}');
  });
  it("my_session_summaries stays own-rows only (sql/128: SECURITY INVOKER + auth.uid() filter)", () => {
    const sql = readFileSync("sql/128_tiktok_send_support.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.my_session_summaries()"), sql.indexOf("$function$;") + 11);
    expect(fn).toContain("security invoker");
    expect(fn).toContain("where l.user_id = (select auth.uid())");
    expect(fn).toContain("from public.live_session_orders l");
  });
});

describe("Orders: picker without Send", () => {
  it("switch-on seller (pastSessions, no tiktokSend): '🗓 Sessions ▾' + past sessions; the buyer card has NO Send", async () => {
    const r = renderOrders({ pastSessions: true });
    expect(q("ord-range")!.textContent).toBe("🗓 Sessions ▾");
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(q("ord-past-heading")).not.toBeNull();
    expect(qa("ord-session-item").length).toBe(2);                 // OLD + BIG (the current one is not listed)
    expect(S.rpcCalls).toBe(1);
    fireEvent.click(q("ord-range")!); // close
    r.type("1");
    expect(q("buyer-receipt")).not.toBeNull();
    expect(q("tt-send-btn")).toBeNull();                            // Send: not for a switch-only seller
  });
  it("Send to TikTok user: the picker AND Send, exactly as today", async () => {
    const r = renderOrders({ tiktokSend: true });
    expect(q("ord-range")!.textContent).toBe("🗓 Sessions ▾");
    r.type("1");
    expect(q("tt-send-btn")).not.toBeNull();
  });
  it("neither: today's menu (This session / Today / 7 days / Custom), no past sessions, no Send", () => {
    const r = renderOrders({});
    expect(q("ord-range")!.textContent).toBe("🗓 This session ▾");
    fireEvent.click(q("ord-range")!);
    expect(q("ord-past-heading")).toBeNull();
    expect(q("ord-range-custom")).not.toBeNull();
    fireEvent.click(q("ord-range")!);
    r.type("1");
    expect(q("tt-send-btn")).toBeNull();
  });
});

describe("mobile + big sessions", () => {
  it("the menu scrolls (max-height 360, overflow auto) and fits a 360 px phone (min-width 250)", async () => {
    renderOrders({ pastSessions: true });
    fireEvent.click(q("ord-range")!);
    await settle();
    const menu = document.querySelector("[role='menu']") as HTMLElement;
    expect(menu.style.maxHeight).toBe("360px");
    expect(menu.style.overflowY).toBe("auto");
    expect(parseInt(menu.style.minWidth, 10)).toBeLessThanOrEqual(360 - 2 * 16);
    for (const b of [q("ord-range")!, ...qa("ord-session-item")]) expect(b.className.includes("sfl-tap44") || parseInt(getComputedStyle(b).padding || "0", 10) >= 9).toBe(true);
  });
  it("picking a 600-order session: a loading note first, then 150 rows + 'Show more' — read-only, never the live board", async () => {
    renderOrders({ pastSessions: true });
    fireEvent.click(q("ord-range")!);
    await settle();
    const big = qa("ord-session-item").find((b) => b.textContent!.includes("10/15"))!; // the 600-order session (rows show dates, not counts)
    expect(big).toBeTruthy();
    fireEvent.click(big);
    expect(document.body.textContent).toContain("Loading this session…");   // before the rows land
    await settle();
    expect(q("ord-past-banner")).not.toBeNull();
    const rows = document.querySelectorAll("[data-testid='ord-row']").length || document.querySelectorAll("[data-testid^='ord-row']").length;
    expect(rows).toBeLessThanOrEqual(150);
    expect(document.body.textContent).toMatch(/Show more/);
    expect(document.body.textContent).not.toContain("Loading this session…");
    // nothing was written anywhere
    const db = await import("../../../db");
    expect((db.saveLiveSessionOrder as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });
});
