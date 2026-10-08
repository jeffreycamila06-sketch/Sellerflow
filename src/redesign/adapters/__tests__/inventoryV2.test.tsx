// F4 — Inventory v2. Pins: switch off = Products and Settings exactly as before and only the
// original adjust_product_stock is ever called; switch on = ± / edit / Restock go through the
// LOGGED RPCs (edit = a delta, never an overwrite), History lists movements newest first,
// the Settings row exists; the RedesignApp wiring (auto log next to the order, the 1-Click
// deduction only in the 1-Click and pin paths, never Enterprise/Auto, gated by the switch
// and the toggle); the productsDb helpers' calls; the sql/90 contract.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })),
  deleteProductDb: vi.fn(async () => true),
  adjustProductStock: vi.fn(async () => 6),
  adjustStockLogged: vi.fn(async () => 6),
  restockProduct: vi.fn(async () => 15),
  logStockMovement: vi.fn(async () => true),
  loadStockMovements: vi.fn(async () => [
    { delta: 10, reason: "restock", orderRef: null, createdAt: "2026-10-08T03:00:00Z" },
    { delta: -1, reason: "auto_order", orderRef: "m1", createdAt: "2026-10-08T02:00:00Z" },
  ]),
}));
import { adjustProductStock, adjustStockLogged, restockProduct, saveProductDbResult, logStockMovement } from "../productsDb";
import Products from "../../screens/Products";
import { TProvider } from "../../i18n";
import { renderScreens } from "./platformWorldScreens";

vi.mock("../useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
const PRODS = [{ id: 7, name: "Dress", sku: "D1", price: 350, stock: 5, platform: "TikTok", status: "Active", liveCode: "A1" }];
beforeEach(() => { localStorage.clear(); localStorage.setItem("sf_prods", JSON.stringify(PRODS)); vi.clearAllMocks(); });
const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Products cur="NT$" {...extra} /></TProvider>);

describe("switch OFF — nothing changes", () => {
  it("renders identical to no prop, no Restock / History", () => {
    const a = view().container.innerHTML;
    const b = view({ inventoryV2: false }).container.innerHTML;
    expect(b).toBe(a);
    expect(screen.queryAllByTestId("restock-7")).toHaveLength(0);
  });
  it("± uses the original adjust_product_stock, never the logged RPC", async () => {
    vi.useFakeTimers();
    try {
      view();
      fireEvent.click(screen.getByTestId("stock-inc-7"));
      await act(async () => { vi.advanceTimersByTime(700); });
      expect(adjustProductStock).toHaveBeenCalledWith(7, 1);
      expect(adjustStockLogged).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("Settings: no deduct row without the handler", () => {
    expect(renderScreens().generalSettings).not.toContain("ls-tg-deduct");
  });
  it("Settings: the deduct row appears with the handler (switch on)", async () => {
    const { default: GS } = await import("../../screens/GeneralSettings");
    const noop = () => {};
    const onT = vi.fn();
    render(<TProvider lang="en"><GS theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop} auto={{ detect: false, toggle: noop }} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop} printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop} liveSessionOpen onToggleLiveSession={noop} deductOneClick={false} onToggleDeductOneClick={onT} /></TProvider>);
    fireEvent.click(screen.getByTestId("ls-tg-deduct"));
    expect(onT).toHaveBeenCalledTimes(1);
  });
});

describe("switch ON", () => {
  it("± goes through the logged RPC (manual_edit)", async () => {
    vi.useFakeTimers();
    try {
      view({ inventoryV2: true });
      fireEvent.click(screen.getByTestId("stock-dec-7"));
      await act(async () => { vi.advanceTimersByTime(700); });
      expect(adjustStockLogged).toHaveBeenCalledWith(7, -1, "manual_edit");
      expect(adjustProductStock).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("Restock: qty → restock_product, the card shows the new stock", async () => {
    view({ inventoryV2: true });
    fireEvent.click(screen.getByTestId("restock-7"));
    fireEvent.change(screen.getByTestId("restock-qty"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("restock-confirm"));
    await waitFor(() => expect(restockProduct).toHaveBeenCalledWith(7, 10));
    await waitFor(() => expect(screen.getByTestId("stock-val-7").textContent).toBe("15"));
  });
  it("edit form: stock written as a LOGGED DELTA after a stock-less save (no overwrite)", async () => {
    view({ inventoryV2: true });
    fireEvent.click(screen.getByText("Edit"));
    const inputs = document.querySelectorAll("form input[type=number]");
    fireEvent.change(inputs[1], { target: { value: "8" } });   // stock 5 → 8
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(saveProductDbResult).toHaveBeenCalled());
    expect((saveProductDbResult as Mock).mock.calls[0][1]).toEqual({ skipStock: true });
    await waitFor(() => expect(adjustStockLogged).toHaveBeenCalledWith(7, 3, "manual_edit"));
  });
  it("new product: starting stock saved and logged once", async () => {
    view({ inventoryV2: true });
    fireEvent.click(screen.getByText("+ Add"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.change(form.querySelector("input") as HTMLInputElement, { target: { value: "Bag" } });
    const nums = form.querySelectorAll("input[type=number]");
    fireEvent.change(nums[0], { target: { value: "100" } });
    fireEvent.change(nums[1], { target: { value: "4" } });
    fireEvent.submit(form);
    await waitFor(() => expect(logStockMovement).toHaveBeenCalledTimes(1));
    expect((logStockMovement as Mock).mock.calls[0].slice(1)).toEqual([4, "manual_edit"]);
    expect((saveProductDbResult as Mock).mock.calls[0][1]).toEqual({ skipStock: false });
  });
  it("History: newest first with reason labels", async () => {
    view({ inventoryV2: true });
    fireEvent.click(screen.getByTestId("history-7"));
    await waitFor(() => expect(screen.getByTestId("history-row-0").textContent).toContain("+10"));
    expect(screen.getByTestId("history-row-0").textContent).toContain("Restock");
    expect(screen.getByTestId("history-row-1").textContent).toContain("Auto order");
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const body = (name: string) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf("\n  };", i)); };
  it("1-Click and pin deduct post-hoc; Enterprise and Auto never do", () => {
    expect(body("onOneClick")).toContain("deductOneClickStock(prod.comment");
    expect(body("handlePinned")).toContain("deductOneClickStock(c.comment");
    expect(body("submitEnt")).not.toContain("deductOneClickStock");
    const d = body("deductOneClickStock");
    expect(d).toContain("if (!featureSw.inventoryV2 || !deductOneClick) return;");
    expect(d).toContain('adjustStockLogged(code.productLocalId, -1, "oneclick"');
    expect(d).toContain("matchCode(text");
  });
  it("auto order: a log row only, after createOrder returned an order, switch-gated", () => {
    const i = src.indexOf("const order = orders.createOrder(c, autoPrice");
    const seg = src.slice(i, src.indexOf("} else {", i));
    expect(seg).toContain('if (featureSw.inventoryV2) void logStockMovement(plan.code.productLocalId, -1, "auto_order"');
  });
  it("Products / Settings get the switch; the order hub is untouched", () => {
    expect(src).toMatch(/<Products cur=\{cur\} [^\n]* inventoryV2=\{featureSw\.inventoryV2\}[^\n]* \/>\}/);
    expect(src).toContain("onToggleDeductOneClick={featureSw.inventoryV2 ? toggleDeductOneClick : undefined}");
    const hub = readFileSync("src/redesign/adapters/useOrders.ts", "utf8");
    expect(hub).not.toMatch(/stock_movements|adjust_product_stock_logged|logStockMovement/);
  });
});

describe("sql/90 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql", "90_stock_movements.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("invoker RPCs, own rows, never touches decrement_product_stock / adjust_product_stock", () => {
    expect(code).not.toMatch(/security definer/i);
    expect(code).not.toMatch(/function public\.(decrement_product_stock|adjust_product_stock)\(/);
    expect(code).toContain("where user_id = (select auth.uid()) and local_id = p_local_id");
    expect(code).toContain("set stock = greatest(0, stock + p_delta)");
  });
  it("select + insert only; no update/delete for the browser; 90-day purge", () => {
    expect(code).toContain("grant select, insert on public.stock_movements to authenticated");
    expect(code).not.toMatch(/grant[^;]*(update|delete)[^;]*stock_movements/i);
    expect(code).toContain("interval '90 days'");
  });
  it("rollback uses plain drops", () => {
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "90_stock_movements_rollback.sql"), "utf8");
    expect(rb).not.toMatch(/if exists/i);
    expect(rb).toContain("drop table public.stock_movements;");
  });
});
