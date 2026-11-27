// CANCEL ORDER (sql/234) on the Orders tab: the ⋯ button, the question sheet (with the "already sent"
// warning), the struck-through row with Undo, and every count / export leaving the cancelled order out.
// Without the `cancel` prop (the gate is closed) the screen has no ⋯ / Undo at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const X = vi.hoisted(() => ({ rows: null as unknown[][] | null }));
vi.mock("../../adapters/brandedExport", async (orig) => {
  const real = await orig<typeof import("../../adapters/brandedExport")>();
  return { ...real, exportBrandedXlsx: async (i: Parameters<typeof real.exportBrandedXlsx>[0]) => { X.rows = i.rows as unknown[][]; } };
});

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import type { Order } from "../../data";
import type { CancelCheck, CancelResult, UndoResult } from "../../adapters/orderCancel";

const ON = Date.UTC(2026, 10, 28, 5);
const o = (id: string, buyer: string, items: string, total: number, n: number, extra: Partial<Order> = {}): Order =>
  ({ id, buyer, handle: `@${buyer.toLowerCase()}`, items, qty: 1, total, time: "13:00", platform: "TikTok", status: "New", date: "2026-11-28", orderNum: ON + n, ...extra } as unknown as Order);
const ROWS = [o("#1", "Ana", "red bag", 150, 1, { ref: "r-1" }), o("#2", "Ben", "blue cap", 200, 2, { ref: "r-2" }), o("#3", "Cara", "old order", 99, 3)];
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

function mkCancel(over: { check?: CancelCheck; cancel?: CancelResult; undo?: UndoResult } = {}) {
  return {
    onCheck: vi.fn(async () => over.check ?? { result: "ok" as const, sent: false }),
    onCancel: vi.fn(async () => over.cancel ?? ("cancelled" as const)),
    onUndo: vi.fn(async () => over.undo ?? ("restored" as const)),
  };
}
const show = (cancel?: ReturnType<typeof mkCancel>, orders: Order[] = ROWS) =>
  render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={orders} state="live" buyers={[]} todayId="2026-11-28" sessionId="cur" sellerId="me" {...(cancel ? { cancel } : {})} /></TProvider>);

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); X.rows = null; });

describe("Orders — cancel order", () => {
  it("gate closed (no cancel prop): no ⋯ and no Undo on any row", () => {
    show();
    expect(qa("ord-more")).toHaveLength(0);
    expect(qa("ord-cx-undo")).toHaveLength(0);
  });

  it("⋯ only on orders that carry a tag (an old order without one has none)", () => {
    show(mkCancel());
    expect(qa("ord-more")).toHaveLength(2);
    expect(document.body.textContent).toContain("old order");
  });

  it("⋯ → the question with the buyer, the amount and the four lines; Keep closes it, nothing is cancelled", async () => {
    const c = mkCancel();
    show(c);
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    const sheet = q("ord-cx-sheet")!;
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain("Ana");
    expect(sheet.textContent).toContain("NT$150");
    expect(sheet.querySelectorAll("li")).toHaveLength(4);
    expect(q("ord-cx-sent")).toBeNull();
    expect(c.onCheck).toHaveBeenCalledTimes(1);
    fireEvent.click(q("ord-cx-keep")!);
    expect(q("ord-cx-sheet")).toBeNull();
    expect(c.onCancel).not.toHaveBeenCalled();
  });

  it("an invoice / receipt already sent to that buyer → the warning line shows", async () => {
    show(mkCancel({ check: { result: "ok", sent: true } }));
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    expect(q("ord-cx-sent")).toBeTruthy();
  });

  it("Cancel → the row is struck through, the chip says Cancelled, the counts leave it out, Undo puts it back", async () => {
    const c = mkCancel();
    show(c);
    expect(document.body.textContent).toContain("NT$449");          // 150 + 200 + 99
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    fireEvent.click(q("ord-cx-yes")!);
    await settle();
    expect(c.onCancel).toHaveBeenCalledTimes(1);
    expect((c.onCancel.mock.calls[0] as unknown as [Order])[0].ref).toBe("r-1");
    expect(q("ord-cx-sheet")).toBeNull();
    expect(qa("ord-cx-chip")).toHaveLength(1);
    expect(qa("ord-cx-undo")).toHaveLength(1);
    expect(qa("ord-more")).toHaveLength(1);           // Ben's still has ⋯
    expect(q("ord-cx-toast")!.textContent).toContain("#1");
    expect(document.body.textContent).toContain("NT$299");          // the cancelled 150 is left out of the total
    expect(document.body.textContent).not.toContain("NT$449");
    fireEvent.click(q("ord-cx-undo")!);
    await settle();
    expect(c.onUndo).toHaveBeenCalledTimes(1);
    expect(qa("ord-cx-chip")).toHaveLength(0);
    expect(qa("ord-more")).toHaveLength(2);
  });

  it("an order that comes in already cancelled (another phone / the reload) shows Cancelled + Undo", () => {
    show(mkCancel(), [o("#1", "Ana", "red bag", 150, 1, { ref: "r-1", cancelled: true }), ROWS[1]]);
    expect(qa("ord-cx-chip")).toHaveLength(1);
    expect(qa("ord-cx-undo")).toHaveLength(1);
  });

  it("a cancelled order is not in the export", async () => {
    show(mkCancel(), [o("#1", "Ana", "red bag", 150, 1, { ref: "r-1", cancelled: true }), ROWS[1]]);
    const exp = Array.from(document.querySelectorAll("button")).find((b) => /export/i.test(b.textContent || "") || /export/i.test(b.getAttribute("aria-label") || ""));
    expect(exp).toBeTruthy();
    fireEvent.click(exp!);
    await settle();
    const xl = Array.from(document.querySelectorAll("button")).find((b) => /excel/i.test(b.textContent || ""));
    if (xl) { fireEvent.click(xl); await settle(); }
    expect(X.rows).toBeTruthy();
    const flat = JSON.stringify(X.rows);
    expect(flat).toContain("blue cap");
    expect(flat).not.toContain("red bag");
  });

  it("the order is gone on the server (not_found) → the sheet says so and stays", async () => {
    show(mkCancel({ check: { result: "not_found", sent: false }, cancel: "not_found" }));
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    expect(q("ord-cx-error")).toBeTruthy();
    fireEvent.click(q("ord-cx-yes")!);
    await settle();
    expect(q("ord-cx-sheet")).toBeTruthy();
    expect(qa("ord-cx-chip")).toHaveLength(0);
  });

  it("a failed cancel → the error line, the order stays as it was", async () => {
    show(mkCancel({ cancel: "error" }));
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    fireEvent.click(q("ord-cx-yes")!);
    await settle();
    expect(q("ord-cx-error")).toBeTruthy();
    expect(qa("ord-cx-chip")).toHaveLength(0);
  });

  it("the check says it was cancelled already (another phone) → no question, the row turns Cancelled", async () => {
    const c = mkCancel({ check: { result: "cancelled", sent: false } });
    show(c);
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    expect(q("ord-cx-sheet")).toBeNull();
    expect(qa("ord-cx-chip")).toHaveLength(1);
    expect(c.onCancel).not.toHaveBeenCalled();
  });

  it("a double tap on Cancel sends ONE request", async () => {
    let release: (v: CancelResult) => void = () => {};
    const c = mkCancel();
    c.onCancel.mockImplementation(() => new Promise<CancelResult>((r) => { release = r; }));
    show(c);
    fireEvent.click(qa("ord-more")[0]);
    await settle();
    fireEvent.click(q("ord-cx-yes")!);
    fireEvent.click(q("ord-cx-yes")!);
    await settle();
    expect(c.onCancel).toHaveBeenCalledTimes(1);
    await act(async () => { release("cancelled"); });
    await settle();
    expect(qa("ord-cx-chip")).toHaveLength(1);
  });
});
