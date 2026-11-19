// "Choose price before print" — the pop-up itself.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChoosePriceSheet from "../ChoosePriceSheet";
import { TProvider, buildT } from "../../i18n";

const item = { key: "click:a", kind: "click" as const, rowId: "a", msgId: "m", name: "Ana Cruz", handle: "anacruz", comment: "mine po" };

describe("ChoosePriceSheet", () => {
  it("buyer, comment, big price buttons (3 per row), default highlighted, Type price + Skip", () => {
    const onPick = vi.fn(), onType = vi.fn(), onSkip = vi.fn();
    render(<TProvider lang="en"><ChoosePriceSheet item={item} prices={[39, 59, 79, 99]} cur="₱" waiting={0} onPick={onPick} onType={onType} onSkip={onSkip} /></TProvider>);
    expect(screen.getByTestId("cpp-name").textContent).toBe("Ana Cruz @anacruz");
    expect(screen.getByTestId("cpp-comment").textContent).toBe("mine po");
    const b0 = screen.getByTestId("cpp-price-0");
    expect(b0.textContent).toBe("₱39");
    expect(b0.getAttribute("data-default")).toBe("1");
    expect((b0 as HTMLElement).style.background).toBe("var(--accent)");
    expect((screen.getByTestId("cpp-price-1") as HTMLElement).style.background).toBe("var(--surface-2)");
    expect(parseInt((b0 as HTMLElement).style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(((b0.parentElement as HTMLElement).style.gridTemplateColumns)).toContain("repeat(3");
    expect(screen.getByTestId("cpp-type").textContent).toBe(buildT("en").rd_dash_enterprise);
    fireEvent.click(screen.getByTestId("cpp-price-3")); expect(onPick).toHaveBeenCalledWith(99);
    fireEvent.click(screen.getByTestId("cpp-type")); expect(onType).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cpp-skip")); expect(onSkip).toHaveBeenCalled();
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    expect(screen.getByTestId("cpp-sheet").getAttribute("role")).toBe("dialog");
  });
  it("\"N more waiting after this\"; no Type price without a row", () => {
    render(<TProvider lang="en"><ChoosePriceSheet item={item} prices={[39]} cur="₱" waiting={2} onPick={vi.fn()} onSkip={vi.fn()} /></TProvider>);
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("2 more waiting after this");
    expect(screen.queryByTestId("cpp-type")).toBeNull();
  });
  it("no browser alert / confirm / prompt anywhere in the pop-up path", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/redesign/components/ChoosePriceSheet.tsx", "utf8");
    expect(src).not.toMatch(/window\.(alert|confirm|prompt)|\balert\(|\bprompt\(/);
    const css = fs.readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).toContain(".sfl-cpp-sheet { width: 100%;");                  // phone: bottom sheet
    expect(css).toMatch(/@media \(min-width: 720px\) \{\n {2}\.sfl-cpp-backdrop \{ align-items: center;/); // wide: centered
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
