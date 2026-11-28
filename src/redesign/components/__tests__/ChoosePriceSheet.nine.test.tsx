// "Choose price before print" — the price window with up to 9 prices.
// 3 prices per row as before. Free (Show Free button on) stays the next cell with 1–8 prices; ONLY with
// exactly 9 prices does it take its own full-width row under the 3 full rows. Every price cell —
// the 7th, 8th, 9th too — answers the same onPick(price, false) a price always did.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import ChoosePriceSheet from "../ChoosePriceSheet";
import { TProvider } from "../../i18n";
import { freeOwnRow, TAP_GUARD_MS, type PickResult, type PriceChoiceItem } from "../../adapters/priceChoiceQueue";
import { MAX_CHOICE_PRICES } from "../../adapters/useChoosePrice";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const item: PriceChoiceItem = { key: "click:a", kind: "click", rowId: "a", msgId: "m", name: "Ana Cruz", handle: "anacruz", comment: "mine po", source: { comment: "mine po" } as ProdComment, soldOutOk: false };
const ALL = [50, 80, 100, 120, 150, 180, 200, 250, 300];
function show(prices: number[], showFree: boolean) {
  const onPick = vi.fn((_p: number, _ok?: boolean, _free?: boolean): PickResult => "ordered");
  render(<TProvider lang="en"><ChoosePriceSheet item={item} prices={prices} cur="₱" waiting={0} onPick={onPick} onSkip={() => {}} blockedText="x" showFree={showFree} /></TProvider>);
  return onPick;
}
const pastGuard = () => act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS + 50); });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-21T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.style.overflow = ""; });

describe("price window, 1–9 prices × Show Free on / off", () => {
  it("Free still takes its own row at 9 (it was the most; since the 12-price change, 12 too — see .twelve)", () => {
    expect(freeOwnRow(9)).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8].some(freeOwnRow)).toBe(false);
    expect(MAX_CHOICE_PRICES).toBe(12);
  });

  for (let n = 1; n <= 9; n++) {
    for (const free of [false, true]) {
      it(`${n} price(s), Free ${free ? "on" : "off"}`, () => {
        show(ALL.slice(0, n), free);
        const p0 = screen.getByTestId("cpp-price-0");
        const grid = p0.parentElement as HTMLElement;
        expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");     // 3 per row, as before
        expect(grid.children).toHaveLength(n + (free ? 1 : 0));
        for (let i = 0; i < n; i++) {
          const b = screen.getByTestId(`cpp-price-${i}`) as HTMLElement;
          expect(b.textContent).toBe(`₱${ALL[i]}`);
          expect(b.style.gridColumn).toBe("");                                       // a price never spans
          expect(b.getAttribute("data-default")).toBe(i === 0 ? "1" : null);
        }
        const f = screen.queryByTestId("cpp-free") as HTMLElement | null;
        if (!free) { expect(f).toBeNull(); return; }
        expect(grid.lastElementChild).toBe(f);                                         // always last
        expect(f!.style.gridColumn).toBe(n === 9 ? "1 / -1" : "");                     // own row ONLY at 9
        expect(f!.getAttribute("data-default")).toBeNull();
      });
    }
  }

  it("with 1–8 prices the Free cell is styled exactly as before (same style object, no new key)", () => {
    show(ALL.slice(0, 8), true);
    const f8 = screen.getByTestId("cpp-free") as HTMLElement;
    const css8 = f8.getAttribute("style");
    cleanup();
    show(ALL.slice(0, 3), true);
    expect((screen.getByTestId("cpp-free") as HTMLElement).getAttribute("style")).toBe(css8);
    cleanup();
    show(ALL, true);
    const decls = (css: string) => css.split(";").map((d) => d.trim()).filter(Boolean).sort();
    const css9 = (screen.getByTestId("cpp-free") as HTMLElement).getAttribute("style")!;
    expect(decls(css9)).toEqual([...decls(css8!), "grid-column: 1 / -1"].sort());     // 9 = the same + its own row
  });

  it("taps on the 7th, 8th and 9th price answer the same call as any price; Free at 9 the same Free call", () => {
    const onPick = show(ALL, true);
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-price-6")); expect(onPick).toHaveBeenLastCalledWith(200, false);
    fireEvent.click(screen.getByTestId("cpp-price-7")); expect(onPick).toHaveBeenLastCalledWith(250, false);
    fireEvent.click(screen.getByTestId("cpp-price-8")); expect(onPick).toHaveBeenLastCalledWith(300, false);
    fireEvent.click(screen.getByTestId("cpp-free")); expect(onPick).toHaveBeenLastCalledWith(0, false, true);
    expect(onPick.mock.calls.slice(0, 3).every((c) => c.length === 2)).toBe(true);   // a price tap: two arguments, as before
  });

  it("the tap-through guard covers the new cells too", () => {
    const onPick = show(ALL, true);
    fireEvent.click(screen.getByTestId("cpp-price-8"));
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
