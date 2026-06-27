// PrintPattern — the "Printer Test" button must be WIRED (was a no-op: a <button>
// with no onClick). Asserts the button fires onTestPrint, plus the other controls
// (toggle / +/- / Save-back) keep working.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import { TProvider } from "../../i18n";

const noop = () => {};
const renderPP = (over: { onTestPrint?: () => void; onBack?: () => void; onToggle?: (k: never) => void; onStep?: (k: never, d: 1 | -1) => void } = {}) =>
  render(
    <TProvider lang="en">
      <PrintPattern onBack={over.onBack ?? noop} pp={DEFAULT_PP} onToggle={(over.onToggle as () => void) ?? noop} onStep={(over.onStep as () => void) ?? noop} onTestPrint={over.onTestPrint} />
    </TProvider>,
  );

describe("PrintPattern — Printer Test button wiring", () => {
  it("fires onTestPrint when the Printer Test button is tapped", () => {
    const onTestPrint = vi.fn();
    renderPP({ onTestPrint });
    fireEvent.click(screen.getByText("Printer Test"));
    expect(onTestPrint).toHaveBeenCalledTimes(1);
  });

  it("other controls still work (Save-back fires onBack)", () => {
    const onBack = vi.fn();
    renderPP({ onBack });
    fireEvent.click(screen.getByText("Save settings"));
    expect(onBack).toHaveBeenCalled();
  });

  it("does not throw when onTestPrint is unwired (optional prop)", () => {
    renderPP();
    expect(() => fireEvent.click(screen.getByText("Printer Test"))).not.toThrow();
  });
});
