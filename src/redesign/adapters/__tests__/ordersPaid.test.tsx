// B2 — paid flag on an order (orders_paid_flag_enabled, sql/101). Pins: orders pair with their
// rows (same buyer#, handle, platform, item, total; n-th oldest with n-th oldest), "Expired" =
// unpaid > 24 h after the order, Orders with the switch (toggle writes ONE update of paid_at on
// that row id, Unpaid pill filters, error shown on a failed write) and without it (no extra
// read, no controls), the order insert never names paid_at, and the sql/101 contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reads: 0, updates: [] as { patch: Record<string, unknown>; id: unknown }[], failUpdate: false }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => ({
      select: () => {
        db.reads++;
        const q = { eq: () => q, gte: () => q, order: () => q, range: async () => ({ data: db.rows, error: null }) };
        return q;
      },
      update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => { db.updates.push({ patch, id }); return { error: db.failUpdate ? { message: "x" } : null }; } }),
    }),
  },
}));

import { matchPaidRows, isPaidExpired, orderKey, PAID_EXPIRE_MS } from "../ordersPaid";
import Orders from "../../screens/Orders";
import { TProvider } from "../../i18n";
import type { Order } from "../../data";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const ord = (bNum: number, item: string, total: number, at: number, handle = "@ann"): Order => ({ id: `#${bNum}`, buyer: "Ann", handle, items: item, qty: 1, total, status: "New", platform: "TikTok", time: "", orderNum: at, date: "2026-10-08" });
const dbRow = (id: number, bNum: number, item: string, price: number, at: number, paid: string | null = null, handle = "ann") => ({ id, buyer_number: bNum, handle, platform: "TikTok", product: item, price, qty: 1, created_at: iso(at), paid_at: paid });

beforeEach(() => { db.rows = []; db.reads = 0; db.updates = []; db.failUpdate = false; });

describe("matchPaidRows", () => {
  it("same group → n-th oldest with n-th oldest; local time differs from the DB time", () => {
    const a = ord(1, "A1", 100, NOW - 5000), b = ord(1, "A1", 100, NOW - 1000), c = ord(2, "B2", 50, NOW - 3000, "@bo");
    const m = matchPaidRows([b, c, a], [dbRow(11, 1, "A1", 100, NOW - 4800), dbRow(12, 1, "A1", 100, NOW - 900, iso(NOW)), dbRow(13, 2, "B2", 50, NOW - 2900, null, "bo")]);
    expect(m.get(orderKey(a))?.id).toBe(11);
    expect(m.get(orderKey(b))).toMatchObject({ id: 12, paidAt: iso(NOW) });
    expect(m.get(orderKey(c))?.id).toBe(13);
  });
  it("no row yet / different item or total → no match", () => {
    const a = ord(1, "A1", 100, NOW), b = ord(1, "A1", 100, NOW + 1);
    const m = matchPaidRows([a, b], [dbRow(11, 1, "A1", 100, NOW), dbRow(12, 1, "A1", 90, NOW)]);
    expect(m.get(orderKey(a))?.id).toBe(11);
    expect(m.has(orderKey(b))).toBe(false);
  });
});

describe("isPaidExpired", () => {
  it("unpaid and older than 24 h only", () => {
    expect(isPaidExpired({ id: 1, paidAt: null, createdAt: iso(NOW - PAID_EXPIRE_MS - 1) }, NOW)).toBe(true);
    expect(isPaidExpired({ id: 1, paidAt: null, createdAt: iso(NOW - PAID_EXPIRE_MS + 1000) }, NOW)).toBe(false);
    expect(isPaidExpired({ id: 1, paidAt: iso(NOW), createdAt: iso(NOW - 2 * PAID_EXPIRE_MS) }, NOW)).toBe(false);
    expect(isPaidExpired(undefined, NOW)).toBe(false);
  });
});

describe("Orders", () => {
  const orders = [ord(1, "A1", 100, NOW - 2 * PAID_EXPIRE_MS), ord(2, "B2", 50, NOW - 1000, "@bo")];
  const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Orders onGoPrint={() => {}} cur="NT$" orders={orders} state="live" todayId="2026-10-08" buyers={[]} {...extra} /></TProvider>);
  it("switch off → no read, no controls, no pill", async () => {
    view();
    await new Promise((r) => setTimeout(r, 10));
    expect(db.reads).toBe(0);
    expect(screen.queryByTestId("ord-paid-btn")).toBeNull();
    expect(screen.queryByTestId("ord-unpaid-pill")).toBeNull();
  });
  it("switch on → Mark paid writes paid_at on that row; Expired after 24 h unpaid; Unpaid pill filters", async () => {
    db.rows = [dbRow(11, 1, "A1", 100, NOW - 2 * PAID_EXPIRE_MS), dbRow(12, 2, "B2", 50, NOW - 900, iso(NOW), "bo")];
    view({ paidFlag: true });
    await waitFor(() => expect(screen.getAllByTestId("ord-paid-btn")).toHaveLength(2));
    expect(db.reads).toBe(1);
    expect(screen.getAllByTestId("ord-expired")).toHaveLength(1);
    const btns = screen.getAllByTestId("ord-paid-btn");
    const unpaidBtn = btns.find((b) => b.getAttribute("aria-pressed") === "false")!;
    fireEvent.click(screen.getByTestId("ord-unpaid-pill"));
    expect(screen.getAllByTestId("ord-paid-btn")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("ord-unpaid-pill"));
    fireEvent.click(unpaidBtn);
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].id).toBe(11);
    expect(Object.keys(db.updates[0].patch)).toEqual(["paid_at"]);
    expect(typeof db.updates[0].patch.paid_at).toBe("string");
    await waitFor(() => expect(screen.queryAllByTestId("ord-expired")).toHaveLength(0));
  });
  it("failed write → error line, mark unchanged", async () => {
    db.rows = [dbRow(11, 1, "A1", 100, NOW - 1000)];
    db.failUpdate = true;
    view({ paidFlag: true, orders: [orders[0]] });
    await waitFor(() => expect(screen.getByTestId("ord-paid-btn")).toBeTruthy());
    fireEvent.click(screen.getByTestId("ord-paid-btn"));
    await waitFor(() => expect(screen.getByTestId("ord-paid-error")).toBeTruthy());
    expect(screen.getByTestId("ord-paid-btn").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("contracts", () => {
  it("the order insert (db.ts) never names paid_at; RedesignApp passes the switch", () => {
    expect(readFileSync("src/db.ts", "utf8")).not.toContain("paid_at");
    expect(readFileSync("src/redesign/RedesignApp.tsx", "utf8")).toContain("paidFlag={featureSw.ordersPaidFlag}");
  });
  it("sql/101: nullable column + switch seeded 'false'; rollback plain drop", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../sql", "101_orders_paid_flag.sql"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sql).toContain("alter table public.live_session_orders add column if not exists paid_at timestamptz;");
    expect(sql).toContain("('orders_paid_flag_enabled', 'false')");
    expect(sql).not.toMatch(/drop |not null|default/i);
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "101_orders_paid_flag_rollback.sql"), "utf8");
    expect(rb).not.toMatch(/if exists/i);
    expect(rb).toContain("alter table public.live_session_orders drop column paid_at;");
  });
});
