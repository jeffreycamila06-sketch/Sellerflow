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
