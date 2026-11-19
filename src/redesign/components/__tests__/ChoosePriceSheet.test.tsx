// "Choose price before print" — the pop-up itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ChoosePriceSheet from "../ChoosePriceSheet";
import { TProvider, buildT } from "../../i18n";
import { TAP_GUARD_MS, type PickResult, type PriceChoiceItem } from "../../adapters/priceChoiceQueue";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const t = buildT("en");
const item: PriceChoiceItem = { key: "click:a", kind: "click", rowId: "a", msgId: "m", name: "Ana Cruz", handle: "anacruz", comment: "mine po", source: { comment: "mine po" } as ProdComment, soldOutOk: false };
const BLOCKED = "Session still loading — try again.";

function show(over: Partial<Parameters<typeof ChoosePriceSheet>[0]> = {}, lang = "en") {
  const onPick = vi.fn((_p: number, _ok?: boolean): PickResult => "ordered");
  const onSkip = vi.fn();
  const r = render(<TProvider lang={lang}><ChoosePriceSheet item={item} prices={[39, 59, 79, 99]} cur="₱" waiting={0} onPick={onPick} onSkip={onSkip} blockedText={BLOCKED} {...over} /></TProvider>);
  return { onPick: (over.onPick as typeof onPick) ?? onPick, onSkip: (over.onSkip as typeof onSkip) ?? onSkip, ...r };
}
// The sheet ignores taps right after it appears — move the clock past that.
const pastGuard = () => act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS + 50); });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-19T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); document.body.style.overflow = ""; });

describe("ChoosePriceSheet — pick", () => {
  it("buyer, comment, big price buttons (3 per row), default highlighted, Type price + Skip", () => {
    const { onPick, onSkip } = show();
    pastGuard();
    expect(screen.getByTestId("cpp-name").textContent).toBe("Ana Cruz @anacruz");
    expect(screen.getByTestId("cpp-comment").textContent).toBe("mine po");
    const b0 = screen.getByTestId("cpp-price-0");
    expect(b0.textContent).toBe("₱39");
    expect(b0.getAttribute("data-default")).toBe("1");
    expect((b0 as HTMLElement).style.background).toBe("var(--accent)");
    expect((screen.getByTestId("cpp-price-1") as HTMLElement).style.background).toBe("var(--surface-2)");
    expect(parseInt((b0 as HTMLElement).style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(((b0.parentElement as HTMLElement).style.gridTemplateColumns)).toContain("repeat(3");
    expect(screen.getByTestId("cpp-type").textContent).toBe(t.rd_dash_enterprise);
    fireEvent.click(screen.getByTestId("cpp-price-3")); expect(onPick).toHaveBeenCalledWith(99, false);
    fireEvent.click(screen.getByTestId("cpp-skip")); expect(onSkip).toHaveBeenCalled();
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    expect(screen.getByTestId("cpp-sheet").getAttribute("role")).toBe("dialog");
  });

  it("\"N more waiting after this\"", () => {
    show({ waiting: 2 });
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("2 more waiting after this");
  });

  it("TAP-THROUGH GUARD: price, Type price and Skip are ignored for ~400 ms after the sheet appears", () => {
    const { onPick, onSkip } = show();
    fireEvent.click(screen.getByTestId("cpp-price-0"));
    fireEvent.click(screen.getByTestId("cpp-skip"));
    fireEvent.click(screen.getByTestId("cpp-type"));
    expect(onPick).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cpp-type-input")).toBeNull();
    act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS - 20); });
    fireEvent.click(screen.getByTestId("cpp-price-0"));
    expect(onPick).not.toHaveBeenCalled();               // still inside the guard
    act(() => { vi.setSystemTime(Date.now() + 40); });
    fireEvent.click(screen.getByTestId("cpp-price-0"));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("long prices use a smaller font (never clipped): NT$12,000 / €1,234.50", () => {
    show({ prices: [12000, 1234.5, 39], cur: "NT$" });
    const big = screen.getByTestId("cpp-price-0") as HTMLElement, short = screen.getByTestId("cpp-price-2") as HTMLElement;
    expect(big.textContent).toBe("NT$12,000");
    expect(parseFloat(big.style.fontSize)).toBeLessThan(parseFloat(short.style.fontSize));
    expect(big.style.textOverflow).toBe("");             // no "…"
    expect(big.style.whiteSpace).toBe("nowrap");
  });
});

describe("ChoosePriceSheet — Type price inside the pop-up", () => {
  it("Type price → a price field + Print + Back; Print sends the typed price through onPick", () => {
    const { onPick } = show();
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-type"));
    expect(screen.getByTestId("cpp-sheet").getAttribute("data-mode")).toBe("type");
    expect(screen.queryByTestId("cpp-price-0")).toBeNull();
    const input = screen.getByTestId("cpp-type-input") as HTMLInputElement;
    const print = screen.getByTestId("cpp-type-print") as HTMLButtonElement;
    expect(print.textContent).toBe(t.rd_cpp_print);
    expect(print.disabled).toBe(true);                   // empty → nothing to print
    fireEvent.change(input, { target: { value: "0" } });
    expect(print.disabled).toBe(true);
    fireEvent.click(print);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "12a5.509" } });
    expect(input.value).toBe("125.50");                  // ₱ has cents: digits + one dot, 2 places
    fireEvent.click(print);
    expect(onPick).toHaveBeenCalledWith(125.5, false);
  });
  it("a currency with no cents takes whole numbers only (same rule as the per-comment Type price)", () => {
    show({ cur: "NT$" });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-type"));
    const input = screen.getByTestId("cpp-type-input") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(input, { target: { value: "350.75" } });
    expect(input.value).toBe("350");
  });
  it("Enter prints too; Back returns to the price buttons without sending anything", () => {
    const { onPick } = show();
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-type"));
    fireEvent.click(screen.getByTestId("cpp-type-back"));
    expect(screen.getByTestId("cpp-price-0")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cpp-type"));
    fireEvent.change(screen.getByTestId("cpp-type-input"), { target: { value: "88" } });
    fireEvent.keyDown(screen.getByTestId("cpp-type-input"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(88, false);
  });
});

describe("ChoosePriceSheet — orders paused / sold out", () => {
  it("\"blocked\" → the sheet stays, shows the message, and the next tap goes through again", () => {
    const onPick = vi.fn<(p: number, ok?: boolean) => PickResult>().mockReturnValueOnce("blocked").mockReturnValue("ordered");
    show({ onPick });
    pastGuard();
    expect(screen.queryByTestId("cpp-blocked")).toBeNull();
    fireEvent.click(screen.getByTestId("cpp-price-1"));
    expect(screen.getByTestId("cpp-blocked").textContent).toBe(BLOCKED);
    expect(screen.getByTestId("cpp-price-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cpp-price-1"));  // no wait needed — the sheet did not remount
    expect(onPick).toHaveBeenCalledTimes(2);
  });
  it("sold out while waiting → asks inside the sheet (no browser dialog): Print anyway / Skip", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onPick = vi.fn<(p: number, ok?: boolean) => PickResult>((_p, ok) => (ok ? "ordered" : { soldOut: "A1" }));
    const { onSkip } = show({ onPick });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-price-1"));
    expect(screen.getByTestId("cpp-soldout").textContent).toBe("A1 is sold out. Print anyway?");
    expect(screen.queryByTestId("cpp-price-0")).toBeNull();
    pastGuard();                                         // the question is guarded like a fresh sheet
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick).toHaveBeenLastCalledWith(59, true);   // the price that was tapped, now confirmed
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cpp-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});

describe("ChoosePriceSheet — the sold-out question is guarded like a fresh sheet", () => {
  it("\"Print anyway\" / \"Skip\" are ignored for ~400 ms after the question opens, then work", () => {
    const onPick = vi.fn<(p: number, ok?: boolean) => PickResult>((_p, ok) => (ok ? "ordered" : { soldOut: "A1" }));
    const { onSkip } = show({ onPick });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-price-0"));          // → the question takes the buttons' place
    expect(screen.getByTestId("cpp-soldout")).toBeTruthy();
    expect(onPick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));      // the same fast tap, no time passed
    fireEvent.click(screen.getByTestId("cpp-skip"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS - 20); });
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick).toHaveBeenCalledTimes(1);                     // still inside the guard
    act(() => { vi.setSystemTime(Date.now() + 40); });
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick).toHaveBeenLastCalledWith(39, true);
    fireEvent.click(screen.getByTestId("cpp-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
  it("a typed price that meets the question is guarded the same way", () => {
    const onPick = vi.fn<(p: number, ok?: boolean) => PickResult>((_p, ok) => (ok ? "ordered" : { soldOut: "B2" }));
    show({ onPick });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-type"));
    fireEvent.change(screen.getByTestId("cpp-type-input"), { target: { value: "88" } });
    fireEvent.click(screen.getByTestId("cpp-type-print"));
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick).toHaveBeenCalledTimes(1);
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick).toHaveBeenLastCalledWith(88, true);
  });
});

describe("ChoosePriceSheet — focus, Tab, background scroll", () => {
  it("focus goes to the sheet itself (not a price button); Tab stays inside", () => {
    show();
    const sheet = screen.getByTestId("cpp-sheet");
    expect(document.activeElement).toBe(sheet);
    const first = screen.getByTestId("cpp-price-0"), last = screen.getByTestId("cpp-skip");
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(document.activeElement).toBe(first);          // wraps forward
    fireEvent.keyDown(sheet, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);           // wraps back
  });
  it("the page behind cannot scroll while the sheet is open; restored when it closes", () => {
    document.body.style.overflow = "auto";
    const { unmount } = show();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("ChoosePriceSheet — keyboard", () => {
  it("the sheet is lifted by the part of the page the keyboard covers (iPhone), and back when it closes", () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: 800, offsetTop: 0, addEventListener: (n: string, f: () => void) => { listeners[n] = f; }, removeEventListener: vi.fn() };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { unmount } = show();
    const back = screen.getByTestId("cpp-backdrop") as HTMLElement;
    expect(back.style.paddingBottom).toBe("");            // no keyboard
    vv.height = 480;                                       // keyboard up: 320 px of the page is covered
    act(() => listeners.resize());
    expect(back.style.paddingBottom).toBe("320px");
    vv.height = 800;
    act(() => listeners.resize());
    expect(back.style.paddingBottom).toBe("");
    unmount();
    expect(vv.removeEventListener).toHaveBeenCalledTimes(2);
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
  });
  it("after a view change the focus is still inside the sheet (sold-out question)", () => {
    const onPick = vi.fn<(p: number, ok?: boolean) => PickResult>(() => ({ soldOut: "A1" }));
    show({ onPick });
    pastGuard();
    const b = screen.getByTestId("cpp-price-0");
    b.focus();
    fireEvent.click(b);
    expect(screen.getByTestId("cpp-sheet").contains(document.activeElement)).toBe(true);
  });
});

describe("source pins", () => {
  it("no browser alert / confirm / prompt; phone bottom sheet, wide centered, safe area", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/redesign/components/ChoosePriceSheet.tsx", "utf8");
    expect(src).not.toMatch(/window\.(alert|confirm|prompt)|\balert\(|\bprompt\(/);
    const css = fs.readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).toContain(".sfl-cpp-sheet { width: 100%;");                  // phone: bottom sheet
    expect(css).toMatch(/@media \(min-width: 720px\) \{\n {2}\.sfl-cpp-backdrop \{ align-items: center;/); // wide: centered
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
  it("every pop-up text exists in all 8 languages", () => {
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = buildT(l) as Record<string, string>;
      for (const k of ["rd_cpp_pop_title", "rd_cpp_skip", "rd_cpp_waiting", "rd_cpp_print", "rd_cpp_soldout_q", "rd_cpp_soldout_yes", "rd_cpp_cleared", "rd_cpp_cleared_one", "rd_dash_enterprise", "rd_sp_back", "rd_sess_order_blocked"]) expect(tl[k], `${l} ${k}`).toBeTruthy();
    }
  });
});

// ── The Free cell ("Show Free button") ─────────────────────────────────────────────────────────
describe("ChoosePriceSheet — Free", () => {
  it("default (switch off / not passed): no Free cell; a price tap makes the SAME call as before (two arguments)", () => {
    const { onPick } = show();
    pastGuard();
    expect(screen.queryByTestId("cpp-free")).toBeNull();
    fireEvent.click(screen.getByTestId("cpp-price-1"));
    expect(onPick.mock.calls[0]).toEqual([59, false]);
  });
  it("3 prices + Free → Free is the 4th and LAST cell; 6 prices + Free → the 7th (third row); green, not the accent, never the default", () => {
    const a = show({ showFree: true, prices: [39, 59, 79] });
    let free = screen.getByTestId("cpp-free");
    expect(Array.from(free.parentElement!.children).indexOf(free)).toBe(3);
    expect(free.parentElement!.lastElementChild).toBe(free);
    expect(free.style.color).toBe("var(--ok)");
    expect(free.style.border).toContain("var(--ok)");
    expect(free.style.background).not.toContain("--accent");
    expect(free.getAttribute("data-default")).toBeNull();
    expect(screen.getByTestId("cpp-price-0").getAttribute("data-default")).toBe("1");
    expect(parseInt(free.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(free.querySelector("svg")).toBeTruthy();
    expect(free.textContent).toBe(t.rd_cpp_free);
    a.unmount();
    show({ showFree: true, prices: [39, 59, 79, 99, 129, 159] });
    free = screen.getByTestId("cpp-free");
    expect(free.parentElement!.children).toHaveLength(7);
    expect(Array.from(free.parentElement!.children).indexOf(free)).toBe(6);
    expect(free.parentElement!.style.gridTemplateColumns).toContain("repeat(3");
  });
  it("one tap → onPick(0, false, true); ignored for 400 ms after the sheet appears", () => {
    const { onPick } = show({ showFree: true });
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(onPick).not.toHaveBeenCalled();                    // tap-through guard
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(onPick.mock.calls).toEqual([[0, false, true]]);
  });
  it("blocked → the sheet stays with the message", () => {
    const onPick = vi.fn((): PickResult => "blocked");
    show({ showFree: true, onPick });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(screen.getByTestId("cpp-blocked").textContent).toBe(BLOCKED);
    expect(screen.getByTestId("cpp-free")).toBeTruthy();
  });
  it("sold out → the question; \"Print anyway\" (after the guard) sends Free again with the answer — still price 0", () => {
    const onPick = vi.fn((_p: number, ok?: boolean): PickResult => (ok ? "ordered" : { soldOut: "D" }));
    show({ showFree: true, onPick });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-free"));
    expect(screen.getByTestId("cpp-soldout")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));   // the same fast tap → ignored
    expect(onPick).toHaveBeenCalledTimes(1);
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-soldout-yes"));
    expect(onPick.mock.calls[1]).toEqual([0, true, true]);
  });
  it("the Type price view has no Free cell (Free is not a typed price)", () => {
    show({ showFree: true });
    pastGuard();
    fireEvent.click(screen.getByTestId("cpp-type"));
    expect(screen.queryByTestId("cpp-free")).toBeNull();
  });
  it("the word follows the app language", () => {
    for (const lang of ["fil", "zh-TW", "th"]) {
      const r = show({ showFree: true }, lang);
      expect(screen.getByTestId("cpp-free").textContent).toBe(buildT(lang).rd_cpp_free);
      r.unmount();
    }
  });
});

