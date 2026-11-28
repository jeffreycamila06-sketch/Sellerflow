// BASKET LIST (paid plans, 2026-11-28) — the sheet behind the 🛒N badge on the Live screen:
// one line per order (item, price or Free, time), Reprint (the parent's zero-write path),
// Cancel with the Orders tab's question + Undo. No "See all" — the list scrolls.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import { BasketSheet, type BasketCancelUi } from "../BasketSheet";
import type { CancelCheck } from "../../adapters/orderCancel";
import { basketOrdersFor, basketListAllowed } from "../../adapters/basketCounts";
import type { Order } from "../../data";

const t = buildT("en");
const o = (n: number, extra: Partial<Order> = {}): Order => ({
  id: "#12", buyer: "Maria Santos", handle: "@maria88", items: `Item ${n}`, qty: 1, total: 100 * n,
  status: "New", platform: "TikTok", time: `9:4${n}:00 PM`, orderNum: 1_700_000_000_000 + n, date: "2026-11-28",
  ref: `r${n}`, ...extra,
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

function mount(orders: Order[], extra: { cancel?: BasketCancelUi; onReprint?: (o: Order) => void; onClose?: () => void; handle?: string } = {}) {
  const host = document.createElement("div");
  host.setAttribute("data-redesign", "");
  document.body.appendChild(host);
  const onClose = extra.onClose ?? vi.fn();
  const r = render(
    <TProvider lang="en">
      <BasketSheet orders={orders} handle={extra.handle ?? "@maria88"} cur="NT$" onClose={onClose}
        {...(extra.onReprint ? { onReprint: extra.onReprint } : {})} {...(extra.cancel ? { cancel: extra.cancel } : {})} />
    </TProvider>,
  );
  return { host, onClose, ...r };
}
const cancelUi = (over: Partial<BasketCancelUi> = {}): BasketCancelUi => ({
  onCheck: vi.fn(async () => ({ result: "ok" as const, sent: false })),
  onCancel: vi.fn(async () => "cancelled" as const),
  onUndo: vi.fn(async () => "restored" as const),
  ...over,
});

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); });

describe("basketOrdersFor (pure) — same identity as the 🛒 count", () => {
  const list: Order[] = [o(3), o(1), o(2), o(4, { handle: "@maria88", platform: "Facebook" }), o(5, { handle: "@maria8" }), o(6, { handle: "@Maria88" })];
  it("only this buyer: handle without @, exact platform; oldest first", () => {
    expect(basketOrdersFor(list, "@maria88", "TikTok").map((x) => x.items)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(basketOrdersFor(list, "maria88", "TikTok")).toHaveLength(3);
    expect(basketOrdersFor(list, "@maria88", "Facebook").map((x) => x.items)).toEqual(["Item 4"]);
  });
  it("nothing for an empty handle or no platform", () => {
    expect(basketOrdersFor(list, "", "TikTok")).toEqual([]);
    expect(basketOrdersFor(list, "@maria88", undefined)).toEqual([]);
  });
  it("cancelled orders stay in the list (so they can be undone)", () => {
    expect(basketOrdersFor([o(1, { cancelled: true }), o(2)], "@maria88", "TikTok")).toHaveLength(2);
  });
});

describe("basketListAllowed (pure) — paid plans + admin", () => {
  const future = "2099-01-01T00:00:00Z", past = "2020-01-01T00:00:00Z";
  it.each([
    ["basic", "active", future, "seller", true],
    ["plus", "active", future, "seller", true],
    ["pro", "active", future, "seller", true],
    ["master", "active", future, "seller", true],
    ["free", "active", "", "seller", false],
    ["free", "active", future, "seller", false],
    ["pro", "active", past, "seller", false],
    ["pro", "pending", future, "seller", false],
    ["free", "active", "", "admin", true],
  ])("plan %s / %s / %s / %s → %s", (plan, planStatus, planExpiry, role, want) => {
    expect(basketListAllowed({ plan, planStatus, planExpiry, role })).toBe(want);
  });
  it("no profile → no", () => { expect(basketListAllowed(null)).toBe(false); });
});

describe("the sheet", () => {
  it("is drawn in the [data-redesign] host (above the bottom nav), one line per order", () => {
    const { host } = mount([o(1), o(2), o(3)]);
    const sheet = screen.getByTestId("bk-sheet");
    expect(host.contains(sheet)).toBe(true);
    expect(screen.getAllByTestId("bk-line")).toHaveLength(3);
    expect(screen.getAllByTestId("bk-item").map((e) => e.textContent)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(screen.getAllByTestId("bk-time").map((e) => e.textContent)).toEqual(["9:41:00 PM", "9:42:00 PM", "9:43:00 PM"]);
    expect(screen.getByTestId("bk-summary").textContent).toContain("3 items");
    expect(screen.getByTestId("bk-summary").textContent).toContain("NT$600");
    expect(sheet.textContent).toContain("#12");
    expect(sheet.textContent).toContain("Maria Santos");
    expect(sheet.textContent).toContain("@maria88");
    expect(screen.queryByText(/see all/i)).toBeNull();
  });
  it("Free orders read Free and add 0 to the total", () => {
    mount([o(1), o(2, { total: 0, items: "FREE" })]);
    expect(screen.getAllByTestId("bk-free")).toHaveLength(1);
    expect(screen.getByTestId("bk-summary").textContent).toContain("NT$100");
  });
  it("one item → '1 item'", () => {
    mount([o(1)]);
    expect(screen.getByTestId("bk-summary").textContent).toContain(t.rd_bk_items_1);
  });
  it("a Facebook name-only buyer shows no @handle", () => {
    mount([o(1, { platform: "Facebook", buyer: "Ana Cruz", handle: "@1234567890" })], { handle: "@1234567890" });
    expect(screen.getByTestId("bk-sheet").textContent).not.toContain("@1234567890");
  });
  it("orders on more than one day show the date before the time", () => {
    mount([o(1, { date: "2026-11-27" }), o(2)]);
    expect(screen.getAllByTestId("bk-time").map((e) => e.textContent)).toEqual(["11/27 9:41:00 PM", "11/28 9:42:00 PM"]);
  });
  it("× , the dim background and Escape close it", () => {
    const a = mount([o(1)]);
    fireEvent.click(screen.getByTestId("bk-close"));
    fireEvent.click(screen.getByTestId("bk-sheet"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(a.onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByTestId("bk-panel"));
    expect(a.onClose).toHaveBeenCalledTimes(3);
  });
});

describe("Reprint", () => {
  it("calls the parent once with THAT order; the buttons rest 2 s", () => {
    vi.useFakeTimers();
    const onReprint = vi.fn();
    mount([o(1), o(2)], { onReprint });
    const btns = screen.getAllByTestId("bk-reprint");
    fireEvent.click(btns[1]);
    expect(onReprint).toHaveBeenCalledTimes(1);
    expect(onReprint.mock.calls[0][0].orderNum).toBe(1_700_000_000_002);
    fireEvent.click(btns[0]); fireEvent.click(btns[1]);
    expect(onReprint).toHaveBeenCalledTimes(1);
    expect(btns[1].textContent).toContain(t.rd_dash_reprinting);
    act(() => { vi.advanceTimersByTime(1900); });
    expect(btns[1].textContent).toContain(t.rd_dash_reprinting); // never "Printed" — the sheet can't know
    expect(btns[1].textContent).not.toMatch(/printed/i);
    act(() => { vi.advanceTimersByTime(200); });
    expect(btns[1].textContent).toContain(t.rd_dash_reprint);
    fireEvent.click(btns[0]);
    expect(onReprint).toHaveBeenCalledTimes(2);
  });
  it("no Reprint without onReprint, on a cancelled order, or without orderNum", () => {
    mount([o(1, { cancelled: true }), o(2, { orderNum: undefined })], { onReprint: vi.fn() });
    expect(screen.queryAllByTestId("bk-reprint")).toHaveLength(0);
  });
});

describe("a printer pop-up on top (No printer connected / Bluetooth is off)", () => {
  it("hidden → the sheet is kept but not shown, Escape is left to the pop-up; shown again after", () => {
    const onClose = vi.fn();
    const props = { orders: [o(1)], handle: "@maria88", cur: "NT$", onClose };
    const r = render(<TProvider lang="en"><BasketSheet {...props} hidden /></TProvider>);
    const sheet = screen.getByTestId("bk-sheet");
    expect(sheet.style.display).toBe("none");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    r.rerender(<TProvider lang="en"><BasketSheet {...props} /></TProvider>);
    expect(screen.getByTestId("bk-sheet").style.display).toBe("flex");
    expect(screen.getAllByTestId("bk-line")).toHaveLength(1);
  });
});

describe("Cancel + Undo", () => {
  it("no Cancel button without the cancel prop, or for an order with no tag", () => {
    mount([o(1)]);
    expect(screen.queryByTestId("bk-cancel")).toBeNull();
    document.body.innerHTML = "";
    mount([o(1, { ref: undefined })], { cancel: cancelUi() });
    expect(screen.queryByTestId("bk-cancel")).toBeNull();
  });
  it("Cancel → the Orders question → Cancel order → Cancelled + Undo, left out of the total", async () => {
    const cx = cancelUi();
    mount([o(1), o(2)], { cancel: cx, onReprint: vi.fn() });
    fireEvent.click(screen.getAllByTestId("bk-cancel")[1]);
    expect(cx.onCheck).toHaveBeenCalledTimes(1);
    expect((cx.onCheck as ReturnType<typeof vi.fn>).mock.calls[0][0].ref).toBe("r2");
    await flush();
    const ask = screen.getByTestId("bk-cx-ask");
    expect(ask.textContent).toContain(t.rd_oc_title);
    expect(ask.textContent).toContain("Item 2");
    expect(screen.queryByTestId("bk-cx-sent")).toBeNull();
    fireEvent.click(screen.getByTestId("bk-cx-yes"));
    await flush();
    expect(cx.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("bk-cx-ask")).toBeNull();
    const line = screen.getAllByTestId("bk-line")[1];
    expect(line.getAttribute("data-cancelled")).toBe("1");
    expect(within(line).getByTestId("bk-cx-chip").textContent).toBe(t.rd_oc_chip);
    expect(within(line).queryByTestId("bk-reprint")).toBeNull();
    expect(screen.getByTestId("bk-summary").textContent).toContain("1 item");
    expect(screen.getByTestId("bk-summary").textContent).toContain("NT$100");
    expect(screen.getByTestId("bk-summary").textContent).toContain("1 cancelled");
    fireEvent.click(within(line).getByTestId("bk-undo"));
    await flush();
    expect(cx.onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("bk-line")[1].getAttribute("data-cancelled")).toBeNull();
    expect(screen.getByTestId("bk-summary").textContent).toContain("2 items");
  });
  it("the 'already sent' warning shows when the check says so", async () => {
    mount([o(1)], { cancel: cancelUi({ onCheck: vi.fn(async () => ({ result: "ok" as const, sent: true })) }) });
    fireEvent.click(screen.getByTestId("bk-cancel"));
    await flush();
    expect(screen.getByTestId("bk-cx-sent").textContent).toContain(t.rd_oc_sent);
  });
  it("Keep order goes back to the list; nothing is cancelled", async () => {
    const cx = cancelUi();
    const a = mount([o(1)], { cancel: cx });
    fireEvent.click(screen.getByTestId("bk-cancel"));
    await flush();
    fireEvent.click(screen.getByTestId("bk-cx-keep"));
    expect(cx.onCancel).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("bk-line")).toHaveLength(1);
    expect(a.onClose).not.toHaveBeenCalled();
  });
  it("Escape / background tap on the question goes back to the list, not out of the sheet", async () => {
    const a = mount([o(1)], { cancel: cancelUi() });
    fireEvent.click(screen.getByTestId("bk-cancel")); await flush();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("bk-cx-ask")).toBeNull();
    fireEvent.click(screen.getByTestId("bk-cancel")); await flush();
    fireEvent.click(screen.getByTestId("bk-sheet"));
    expect(screen.queryByTestId("bk-cx-ask")).toBeNull();
    expect(a.onClose).not.toHaveBeenCalled();
  });
  it("a refused cancel shows the error and keeps the order", async () => {
    mount([o(1)], { cancel: cancelUi({ onCancel: vi.fn(async () => "error" as const) }) });
    fireEvent.click(screen.getByTestId("bk-cancel")); await flush();
    fireEvent.click(screen.getByTestId("bk-cx-yes")); await flush();
    expect(screen.getByTestId("bk-error").textContent).toBe(t.rd_oc_failed);
    fireEvent.click(screen.getByTestId("bk-cx-keep"));
    expect(screen.getAllByTestId("bk-line")[0].getAttribute("data-cancelled")).toBeNull();
  });
  it("an order not saved yet: the 'not ready' line and Cancel order stays off while checking", async () => {
    let done!: (v: CancelCheck) => void;
    mount([o(1)], { cancel: cancelUi({ onCheck: vi.fn(() => new Promise<CancelCheck>((r) => { done = r; })) }) });
    fireEvent.click(screen.getByTestId("bk-cancel"));
    expect((screen.getByTestId("bk-cx-yes") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { done({ result: "not_found", sent: false }); });
    expect(screen.getByTestId("bk-error").textContent).toBe(t.rd_oc_not_ready);
  });
  it("cancelled on another phone already → shown as Cancelled, no question", async () => {
    mount([o(1)], { cancel: cancelUi({ onCheck: vi.fn(async () => ({ result: "cancelled" as const, sent: false })) }) });
    fireEvent.click(screen.getByTestId("bk-cancel")); await flush();
    expect(screen.queryByTestId("bk-cx-ask")).toBeNull();
    expect(screen.getByTestId("bk-cx-chip")).toBeTruthy();
  });
  it("a refused undo keeps it cancelled and says so", async () => {
    mount([o(1, { cancelled: true })], { cancel: cancelUi({ onUndo: vi.fn(async () => "error" as const) }) });
    fireEvent.click(screen.getByTestId("bk-undo")); await flush();
    expect(screen.getByTestId("bk-error").textContent).toBe(t.rd_oc_undo_failed);
    expect(screen.getByTestId("bk-cx-chip")).toBeTruthy();
  });
});
