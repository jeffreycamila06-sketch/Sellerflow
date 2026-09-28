// Low-stock warning — moved from Settings → Live session to a compact settings card at
// the TOP of the Products screen (approved mockup). Same localStorage key
// (sfl_rd_auto_lowstock via load/saveLowStockThreshold), same 0..99 clamp, behavior
// unchanged. The harness wires the card exactly as RedesignApp does (state seeded by
// loadLowStockThreshold, setter = set + saveLowStockThreshold).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import Products from "../Products";
import { TProvider } from "../../i18n";
import { AUTO_LOWSTOCK_KEY, loadLowStockThreshold, saveLowStockThreshold } from "../../adapters/autoStatus";

vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })),
  deleteProductDb: vi.fn(async () => true),
}));

function Wired() {
  const [n, setN] = useState(() => loadLowStockThreshold());
  return (
    <TProvider lang="en">
      <Products cur="NT$" lowStockThreshold={n} onSetLowStockThreshold={(v) => { setN(v); saveLowStockThreshold(v); }} />
    </TProvider>
  );
}
const input = () => screen.getByTestId("prd-lowstock-input") as HTMLInputElement;

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
beforeEach(() => { localStorage.clear(); });

describe("Products — Low-stock warning card", () => {
  it("renders at the top (before the stat tiles) with the label + helper", () => {
    render(<Wired />);
    const card = screen.getByTestId("prd-lowstock-card");
    expect(card.textContent).toContain("Low-stock warning at");
    expect(card.textContent).toContain("Warn me on the Live screen when a product's Live code drops to this many or fewer. 0 turns it off.");
    const tiles = screen.getByText("Total"); // first stat tile label
    expect(card.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("READS the stored key (sfl_rd_auto_lowstock) — default 3 when unset", () => {
    render(<Wired />);
    expect(input().value).toBe("3");
  });

  it("READS a previously saved value", () => {
    localStorage.setItem(AUTO_LOWSTOCK_KEY, "5");
    render(<Wired />);
    expect(input().value).toBe("5");
  });

  it("WRITES the key on change, clamped 0..99 (behavior unchanged)", () => {
    render(<Wired />);
    fireEvent.change(input(), { target: { value: "7" } });
    expect(localStorage.getItem(AUTO_LOWSTOCK_KEY)).toBe("7");
    expect(input().value).toBe("7");
    fireEvent.change(input(), { target: { value: "150" } });
    expect(localStorage.getItem(AUTO_LOWSTOCK_KEY)).toBe("99");
    fireEvent.change(input(), { target: { value: "" } });
    expect(localStorage.getItem(AUTO_LOWSTOCK_KEY)).toBe("0"); // 0 turns the warning off
  });

  it("no handler → no card", () => {
    render(<TProvider lang="en"><Products cur="NT$" /></TProvider>);
    expect(screen.queryByTestId("prd-lowstock-card")).toBeNull();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("Products gets the low-stock threshold; GeneralSettings no longer does", () => {
    expect(src).toContain("<Products cur={cur} lowStockThreshold={autoLowStock} onSetLowStockThreshold={setAutoLowStockThreshold}");
    const gs = src.slice(src.indexOf("<GeneralSettings"), src.indexOf("/>", src.indexOf("<GeneralSettings")));
    expect(gs).not.toContain("lowStockThreshold");
    expect(src).toContain("const setAutoLowStockThreshold = useCallback((n: number) => { setAutoLowStock(n); saveLowStockThreshold(n); }, []);");
  });
});
