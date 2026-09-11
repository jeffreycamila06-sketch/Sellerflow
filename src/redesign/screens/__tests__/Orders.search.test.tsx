// Unified Orders search — screen contract (torn-sticker recovery):
//   • ONE input filters window + history rows live; ✕ clears;
//   • the lazy history fetch is triggered by the FIRST keystroke only;
//   • history results appear ONLY while searching, each with a date chip;
//   • the 7-day boundary note vs the plain no-match vs the honest fetch-error;
//   • ↻ Reprint on result rows fires onReprintOrder exactly once and never
//     co-fires the row's go-to-Print onClick (stopPropagation).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Orders from "../Orders";
import type { Order } from "../../data";

const o = (over: Partial<Order>): Order => ({
  id: "#23", buyer: "Mei Lin", handle: "@meidolltw", items: "korean dress D", qty: 1,
  total: 899, status: "New", platform: "TikTok", time: "1:24:49 PM", orderNum: 111, date: "2026-07-13",
  ...over,
});
const windowOrders = [o({}), o({ id: "#7", buyer: "Yu Shan", handle: "@yushan_tw", items: "tumbler B", total: 350, orderNum: 222 })];
const histOrders = [o({ id: "#4", buyer: "Ben Wu", handle: "@benwu", items: "korean jacket", total: 1200, orderNum: 333, date: "2026-07-10" })];

const renderOrders = (over: Record<string, unknown> = {}) =>
  render(
    <TProvider lang="en">
      <Orders onGoPrint={vi.fn()} cur="NT$" orders={windowOrders} state="live" todayId="2026-07-13"
        historyOrders={histOrders} historyState="live" onEnsureHistory={vi.fn()} onReprintOrder={vi.fn()} {...over} />
    </TProvider>,
  );
const input = (c: HTMLElement) => c.querySelector("input") as HTMLInputElement;

describe("unified search input", () => {
  it("filters window rows live and clears with ✕", () => {
    const { container, getByLabelText } = renderOrders();
    fireEvent.change(input(container), { target: { value: "yushan" } });
    expect(container.textContent).toContain("Yu Shan");
    expect(container.textContent).not.toContain("Mei Lin");
    fireEvent.click(getByLabelText("clear"));
    expect(input(container).value).toBe("");
    expect(container.textContent).toContain("Mei Lin");
  });

  it("triggers the lazy history fetch on the first keystroke", () => {
    const onEnsureHistory = vi.fn();
    const { container } = renderOrders({ onEnsureHistory });
    fireEvent.change(input(container), { target: { value: "k" } });
    expect(onEnsureHistory).toHaveBeenCalled();
  });

  it("history rows appear ONLY while searching, and carry the date chip", () => {
    const { container } = renderOrders();
    expect(container.textContent).not.toContain("Ben Wu");           // plain list = window only
    fireEvent.change(input(container), { target: { value: "korean" } });
    expect(container.textContent).toContain("Ben Wu");               // history joins the results
    expect(container.textContent).toContain("07/10");                // date chip disambiguates
    expect(container.textContent).toContain("Mei Lin");              // window match shown together
  });

  it("no-match states: 7-day boundary note when history is loaded; searching chip while loading; honest error note", () => {
    const { container: live } = renderOrders();
    fireEvent.change(input(live), { target: { value: "zzz" } });
    expect(live.textContent).toContain("No match in the last 7 days");
    const { container: loading } = renderOrders({ historyState: "loading" });
    fireEvent.change(input(loading), { target: { value: "zzz" } });
    expect(loading.textContent).toContain("Searching the last 7 days");
    const { container: err } = renderOrders({ historyState: "error" });
    fireEvent.change(input(err), { target: { value: "zzz" } });
    expect(err.textContent).toContain("Couldn’t search older orders");
  });
});

describe("↻ Reprint on result rows", () => {
  it("fires onReprintOrder once with the row's order and never co-fires the row onClick", () => {
    const onReprintOrder = vi.fn();
    const onGoPrint = vi.fn();
    const { container } = renderOrders({ onReprintOrder, onGoPrint });
    fireEvent.change(input(container), { target: { value: "yushan" } });
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("↻"))!;
    fireEvent.click(btn);
    expect(onReprintOrder).toHaveBeenCalledTimes(1);
    expect(onReprintOrder.mock.calls[0][0].orderNum).toBe(222);
    expect(onGoPrint).not.toHaveBeenCalled();                        // stopPropagation held
    fireEvent.click(btn);
    expect(onReprintOrder).toHaveBeenCalledTimes(1);                 // 2s global cooldown
  });
});

// ── Buyer receipt box (2026-09-11, Option A) ─────────────────────────────────
// A pure-digit search that EXACTLY matches a session buyer# shows ONE grouped
// receipt card and NOTHING else (no list). Display-only (no onGoPrint). Non-
// numeric = normal list. Numeric no-match = no box, normal no-match note.
import type { Buyer, LiveOrder } from "../../../lib/orderTypes";
const lo = (item: string, total: number): LiveOrder => ({
  orderNum: 1e12 + total, item, qty: 1, price: total, total, time: "1:00:00 PM",
  handle: "@maria", name: "Maria", bNum: 1, platform: "TikTok", status: "New", date: "2026-07-13",
});
const receiptBuyers: Buyer[] = [
  { handle: "@maria", name: "Maria", platform: "TikTok", num: 1, totalOrders: 3, totalSpent: 1820,
    orders: [lo("Red dress M", 550), lo("Blue top L", 380), lo("Sneakers 38", 890)] },
  { handle: "@ken", name: "Ken", platform: "TikTok", num: 10, totalOrders: 1, totalSpent: 200,
    orders: [{ ...lo("Cap", 200), name: "Ken", bNum: 10 }] },
];

describe("buyer receipt box", () => {
  it('"1" shows the receipt box only (not #10), never the list', () => {
    const onGoPrint = vi.fn();
    const { container } = renderOrders({ buyers: receiptBuyers, onGoPrint });
    fireEvent.change(input(container), { target: { value: "1" } });
    const box = container.querySelector('[data-testid="buyer-receipt"]')!;
    expect(box).toBeTruthy();
    expect(box.textContent).toContain("Maria");
    expect(box.textContent).toContain("Red dress M");
    expect(box.textContent).toContain("NT$1,820");         // buyer.totalSpent
    expect(box.textContent).toContain("3 items");
    expect(container.textContent).not.toContain("Ken");     // #10 not pulled in (exact match)
    // display-only: tapping the box never navigates to Print
    fireEvent.click(box);
    expect(onGoPrint).not.toHaveBeenCalled();
  });

  it('"Maria" (non-numeric) shows the normal list, no receipt box', () => {
    const { container } = renderOrders({ buyers: receiptBuyers });
    fireEvent.change(input(container), { target: { value: "Mei" } });
    expect(container.querySelector('[data-testid="buyer-receipt"]')).toBeNull();
    expect(container.textContent).toContain("Mei Lin");     // normal filtered row
  });

  it("numeric query with no matching buyer → no box, falls back to no-match", () => {
    const { container } = renderOrders({ buyers: receiptBuyers });
    fireEvent.change(input(container), { target: { value: "999" } });
    expect(container.querySelector('[data-testid="buyer-receipt"]')).toBeNull();
  });

  it("137-order buyer renders every line, scrollable, total intact (AUD symbol)", () => {
    const many: LiveOrder[] = Array.from({ length: 137 }, (_, i) => lo(`Item ${i + 1}`, 100));
    const big: Buyer[] = [{ handle: "@big", name: "Big", platform: "TikTok", num: 5, totalOrders: 137, totalSpent: 13700, orders: many }];
    const { container } = renderOrders({ buyers: big, cur: "A$" });
    fireEvent.change(input(container), { target: { value: "5" } });
    const box = container.querySelector('[data-testid="buyer-receipt"]') as HTMLElement;
    expect(box.textContent).toContain("Item 137");
    expect(box.textContent).toContain("A$13,700");          // AUD symbol, not hardcoded NT$
    expect(box.textContent).toContain("137 items");
    const scroll = Array.from(box.querySelectorAll("div")).find((d) => d.style.overflowY === "auto");
    expect(scroll).toBeTruthy();                             // scroll region present
  });
});
