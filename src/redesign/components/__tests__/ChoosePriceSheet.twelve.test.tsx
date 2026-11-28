// "Choose price before print" — the price window with up to 12 prices (3 per row, 4 rows).
// Free (Show Free button on) is the next cell with 10 or 11 prices and takes its own full-width row with 12
// (4 full rows) — exactly as with 9 (3 full rows). 1–9 are byte-for-byte as before (ChoosePriceSheet.nine).
// Every price cell — the 10th, 11th, 12th too — answers the same onPick(price, false) a price always did.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import ChoosePriceSheet from "../ChoosePriceSheet";
import { TProvider } from "../../i18n";
import { freeOwnRow, TAP_GUARD_MS, type PickResult, type PriceChoiceItem } from "../../adapters/priceChoiceQueue";
import { MAX_CHOICE_PRICES } from "../../adapters/useChoosePrice";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const item: PriceChoiceItem = { key: "click:a", kind: "click", rowId: "a", msgId: "m", name: "Ana Cruz", handle: "anacruz", comment: "mine po", source: { comment: "mine po" } as ProdComment, soldOutOk: false };
const ALL = [50, 80, 100, 120, 150, 180, 200, 250, 300, 350, 400, 500];
function show(prices: number[], showFree: boolean) {
  const onPick = vi.fn((_p: number, _ok?: boolean, _free?: boolean): PickResult => "ordered");
  render(<TProvider lang="en"><ChoosePriceSheet item={item} prices={prices} cur="₱" waiting={0} onPick={onPick} onSkip={() => {}} blockedText="x" showFree={showFree} /></TProvider>);
  return onPick;
}
const pastGuard = () => act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS + 50); });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-28T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.style.overflow = ""; });

describe("price window, 10–12 prices × Show Free on / off", () => {
  it("Free takes its own row only at 9 and 12 (full rows of 3); 12 is the most a seller can save", () => {
    expect(MAX_CHOICE_PRICES).toBe(12);
    expect(Array.from({ length: 12 }, (_, i) => i + 1).filter(freeOwnRow)).toEqual([9, 12]);
    expect(freeOwnRow(MAX_CHOICE_PRICES)).toBe(true);
  });

  for (let n = 10; n <= 12; n++) {
    for (const free of [false, true]) {
      it(`${n} prices, Free ${free ? "on" : "off"}`, () => {
        show(ALL.slice(0, n), free);
        const grid = screen.getByTestId("cpp-price-0").parentElement as HTMLElement;
        expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
        expect(grid.children).toHaveLength(n + (free ? 1 : 0));
        for (let i = 0; i < n; i++) {
          const b = screen.getByTestId(`cpp-price-${i}`) as HTMLElement;
          expect(b.textContent).toBe(`₱${ALL[i]}`);
          expect(b.style.gridColumn).toBe("");
          expect(b.getAttribute("data-default")).toBe(i === 0 ? "1" : null);
        }
        const f = screen.queryByTestId("cpp-free") as HTMLElement | null;
        if (!free) { expect(f).toBeNull(); return; }
        expect(grid.lastElementChild).toBe(f);
        expect(f!.style.gridColumn).toBe(n === 12 ? "1 / -1" : "");
      });
    }
  }

  it("Free at 12 is styled exactly like Free at 9 (same own-row style); at 10 and 11 like Free at 1–8", () => {
    const css = (n: number) => { show(ALL.slice(0, n), true); const c = (screen.getByTestId("cpp-free") as HTMLElement).getAttribute("style"); cleanup(); return c; };
    expect(css(12)).toBe(css(9));
    expect(css(10)).toBe(css(8));
    expect(css(11)).toBe(css(8));
  });

  it("taps on the 10th, 11th and 12th price answer the same call as any price; Free at 12 the same Free call", () => {
    const onPick = show(ALL, true);
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-price-9")); expect(onPick).toHaveBeenLastCalledWith(350, false);
    fireEvent.click(screen.getByTestId("cpp-price-10")); expect(onPick).toHaveBeenLastCalledWith(400, false);
    fireEvent.click(screen.getByTestId("cpp-price-11")); expect(onPick).toHaveBeenLastCalledWith(500, false);
    fireEvent.click(screen.getByTestId("cpp-free")); expect(onPick).toHaveBeenLastCalledWith(0, false, true);
    expect(onPick.mock.calls.slice(0, 3).every((c) => c.length === 2)).toBe(true);
  });

  it("the tap-through guard covers the new cells too", () => {
    const onPick = show(ALL, true);
    fireEvent.click(screen.getByTestId("cpp-price-11"));
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
