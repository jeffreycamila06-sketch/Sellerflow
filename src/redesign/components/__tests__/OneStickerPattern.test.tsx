// The NEW Live print pattern screen (one sticker) — what the seller can do, and the per-device opt-in.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";

const renderIt = (over: Partial<Parameters<typeof OneStickerPattern>[0]> = {}) => {
  const onSave = vi.fn(), onTest = vi.fn();
  render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 100, h: 60 })} savedOnDevice={false} onSave={onSave} shopName="Maria Ukay" devicePath="laptop" qrAllowed onTest={onTest} {...over} /></TProvider>);
  return { onSave, onTest };
};

describe("OneStickerPattern", () => {
  it("shows the exact preview, the test buttons, every size chip + Custom, all part rows, the fixed date row and the QR row; no logo row", () => {
    renderIt();
    expect(screen.getByTestId("os-preview")).toBeTruthy();
    for (const id of ["os-test", "os-test-en", "os-test-zh"]) expect(screen.getByTestId(id)).toBeTruthy();
    for (const z of ["50x30", "60x40", "70x50", "80x50", "80x60", "100x60"]) expect(screen.getByTestId(`os-size-${z}`)).toBeTruthy();
    expect(screen.getByTestId("os-size-custom")).toBeTruthy();
    for (const k of ["shop", "buyer", "name", "user", "comment"]) {
      expect(screen.getByTestId(`os-row-${k}`)).toBeTruthy();
      for (const w of ["normal", "bold", "extra"]) expect(screen.getByTestId(`os-${k}-w-${w}`)).toBeTruthy();
      expect(screen.getByTestId(`os-${k}-scale`).textContent).toBe("1×");
    }
    expect(screen.getByTestId("os-row-date").textContent).toContain("Always printed");
    expect(screen.getByTestId("os-row-qr").textContent).toContain("TikTok buyers only");
    expect(screen.queryByText(/logo/i)).toBeNull();
    expect(screen.queryByText(/SellerFlowLive/)).toBeNull();
  });
  it("under the preview: \"Exact preview · W×H mm\" and the notes (fits / red only when a part runs off)", async () => {
    renderIt();
    expect(screen.getByTestId("os-caption").textContent).toBe("Exact preview · 100×60 mm");
    expect((await screen.findByTestId("os-note-ok")).textContent).toBe("Everything fits");
    expect(screen.queryByTestId("os-fit")).toBeNull();
    fireEvent.click(screen.getByTestId("os-size-50x30"));
    expect(screen.getByTestId("os-caption").textContent).toBe("Exact preview · 50×30 mm");
    for (const k of ["shop", "buyer", "name", "user", "comment"]) for (let i = 0; i < 9; i++) fireEvent.click(screen.getByTestId(`os-${k}-plus`));
    expect((await screen.findByTestId("os-fit")).textContent).toContain("Too big");
    expect(screen.getByTestId("os-row-comment").textContent).toContain("Shrinks automatically when long");
    expect(screen.getByTestId("os-row-date").textContent).toContain("Fixed size");
  });
  it("Normal / Bold / Extra: under the name beside the size + switch on a wide row, their own line on a narrow row — never over the stepper; each ≥ 44×44", () => {
    renderIt();
    for (const k of ["shop", "buyer", "name", "user", "comment"]) {
      const weights = screen.getByTestId(`os-${k}-weights`);
      expect(weights.className).toBe("os-row-w");
      expect(weights.contains(screen.getByTestId(`os-${k}-stepper`))).toBe(false);
      for (const w of ["normal", "bold", "extra"]) {
        const b = screen.getByTestId(`os-${k}-w-${w}`);
        expect(parseFloat(b.style.minWidth)).toBeGreaterThanOrEqual(44);
        expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
      }
    }
    const css = document.querySelector("style")!.textContent!.replace(/\s+/g, " ");
    expect(css).toContain('grid-template-areas:"name ctl" "w w"');                       // narrow: own line
    expect(css).toMatch(/@container \(min-width:\d+px\)\{\.os-row-grid\{grid-template-areas:"name ctl" "w ctl"\}\}/); // wide: preview
    expect(css).toContain(".os-row-w{grid-area:w;display:flex;flex-wrap:wrap");
  });
  it("Custom W × H: one line (the × never wraps alone), inputs full width and ≥ 44 px", () => {
    renderIt();
    fireEvent.click(screen.getByTestId("os-size-custom"));
    for (const id of ["os-custom-w", "os-custom-h"]) {
      const el = screen.getByTestId(id) as HTMLInputElement;
      expect(el.style.width).toBe("100%");
      expect(parseFloat(el.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    expect((screen.getByTestId("os-custom").firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("minmax(0,1fr) auto minmax(0,1fr)");
  });
  it("a part switched OFF: its size and weight are dimmed and cannot be changed (the switch still works)", () => {
    const { onSave } = renderIt();
    fireEvent.click(screen.getByTestId("os-name-on"));
    expect(screen.getByTestId("os-row-name").getAttribute("data-off")).toBe("1");
    for (const id of ["os-name-plus", "os-name-minus", "os-name-w-normal", "os-name-w-bold", "os-name-w-extra"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    expect(screen.getByTestId("os-name-stepper").style.opacity).toBe("0.4");
    expect(screen.getByTestId("os-name-weights").style.opacity).toBe("0.4");
    fireEvent.click(screen.getByTestId("os-name-plus"));
    expect(screen.getByTestId("os-name-scale").textContent).toBe("1×");
    fireEvent.click(screen.getByTestId("os-name-on")); // back on → usable again
    expect((screen.getByTestId("os-name-plus") as HTMLButtonElement).disabled).toBe(false);
    void onSave;
  });
  it("laptop (≥760 px): two columns — the preview column (picture, notes, tests) sticky on the left, the controls on the right", () => {
    renderIt();
    const pv = screen.getByTestId("os-pv-col"), ctl = screen.getByTestId("os-ctl-col");
    for (const id of ["os-preview", "os-notes", "os-test", "os-test-en", "os-test-zh"]) expect(pv.contains(screen.getByTestId(id)), id).toBe(true);
    for (const id of ["os-size-card", "os-row-shop", "os-row-comment", "os-reset", "os-save"]) expect(ctl.contains(screen.getByTestId(id)), id).toBe(true);
    expect(pv.compareDocumentPosition(ctl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // preview first = left
    const css = document.querySelector("style")!.textContent!.replace(/\s+/g, " ");
    expect(css).toContain("@container (min-width:760px)");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)");
    expect(css).toMatch(/\.os-pv\{position:sticky;top:\d+px\}/);
  });
  it("the QR row is always shown: on an account without QR it is greyed out with a short hint", () => {
    renderIt({ qrAllowed: false });
    const row = screen.getByTestId("os-row-qr");
    expect(row.textContent).toContain("Not available on your account");
    const sw = screen.getByTestId("os-qr-on") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true); // nothing changed
  });
  it("every button on the screen is at least 44 px tall to tap (steppers, chips, weights, switches, Back, tests, Reset, Save)", () => {
    renderIt();
    fireEvent.click(screen.getByTestId("os-size-custom"));
    const small: string[] = [];
    for (const b of Array.from(screen.getByTestId("os-screen").querySelectorAll("button"))) {
      const h = Math.max(parseFloat(b.style.minHeight || "0"), parseFloat(b.style.height || "0"));
      if (!(h >= 44)) small.push(`${b.getAttribute("data-testid") ?? b.textContent}: ${h}`);
    }
    expect(small).toEqual([]);
  });
  it("Reset to recommended shows a short message, like the preview", () => {
    const onToast = vi.fn();
    renderIt({ onToast });
    fireEvent.click(screen.getByTestId("os-reset"));
    expect(onToast).toHaveBeenCalledWith("Back to recommended settings");
  });
  it("the preview of a tall / square label is at most min(60vh, 420 px) high, width auto, same shape", () => {
    renderIt({ initial: { ...recommendedSettings({ w: 50, h: 70 }), size: { w: 50, h: 70, custom: true } } });
    const c = screen.getByTestId("os-preview") as HTMLCanvasElement;
    expect(c.style.maxHeight).toBe("min(60vh, 420px)");
    expect(c.style.width).toBe("auto");
    expect(c.style.maxWidth).toBe("100%");
    expect(c.style.aspectRatio).toBe("50 / 70");
  });
  it("rows follow the approved preview: Shop name → Date & time → Buyer # → Name → @username → Print QR → Comment / Price", () => {
    renderIt();
    const ids = Array.from(document.querySelectorAll("[data-testid^='os-row-']")).map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["os-row-shop", "os-row-date", "os-row-buyer", "os-row-name", "os-row-user", "os-row-qr", "os-row-comment"]);
  });
  it("Save is off until something changes; Save hands the settings to the device", () => {
    const { onSave } = renderIt();
    const save = screen.getByTestId("os-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("os-device-note").textContent).toContain("keeps today's sticker");
    fireEvent.click(screen.getByTestId("os-comment-plus"));
    expect(screen.getByTestId("os-comment-scale").textContent).toBe("1.15×");
    fireEvent.click(screen.getByTestId("os-name-w-extra"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].parts.comment.scale).toBe(1.15);
    expect(onSave.mock.calls[0][0].parts.name.weight).toBe("extra");
    expect(screen.getByTestId("os-device-note").textContent).toContain("This device prints this sticker");
  });
  it("the stepper walks the approved ladder 0.6 … 2 and stops at the ends", () => {
    renderIt();
    for (let i = 0; i < 9; i++) fireEvent.click(screen.getByTestId("os-buyer-plus"));
    expect(screen.getByTestId("os-buyer-scale").textContent).toBe("2×");
    for (let i = 0; i < 15; i++) fireEvent.click(screen.getByTestId("os-buyer-minus"));
    expect(screen.getByTestId("os-buyer-scale").textContent).toBe("0.6×");
  });
  it("50×30: the shop name row says it is not printed", () => {
    renderIt();
    fireEvent.click(screen.getByTestId("os-size-50x30"));
    expect(screen.getByTestId("os-row-shop").textContent).toContain("Not on labels this small");
  });
  it("Custom size: 30–110 mm each, inline error otherwise; Save blocked while wrong", () => {
    const { onSave } = renderIt();
    fireEvent.click(screen.getByTestId("os-size-custom"));
    fireEvent.change(screen.getByTestId("os-custom-w"), { target: { value: "25" } });
    expect(screen.getByTestId("os-custom-err").textContent).toContain("30–110 mm");
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("os-custom-w"), { target: { value: "40" } });
    fireEvent.change(screen.getByTestId("os-custom-h"), { target: { value: "30" } });
    expect(screen.queryByTestId("os-custom-err")).toBeNull();
    fireEvent.click(screen.getByTestId("os-save"));
    expect(onSave.mock.calls[0][0].size).toEqual({ w: 40, h: 30, custom: true });
  });
  it("warns when the size is wider than the saved printer takes (Niimbot B1 = 50 mm)", () => {
    renderIt({ printerName: "B1-H123", devicePath: "niimbot" });
    expect(screen.getByTestId("os-too-wide").textContent).toContain("B1");
    fireEvent.click(screen.getByTestId("os-name-w-extra")); // a change, but the size is too wide → Save stays off
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("os-size-50x30"));
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("os-too-wide")).toBeNull();
  });
  it("a printer on the older text sticker: Custom is hidden with a short note", () => {
    renderIt({ devicePath: "text" });
    expect(screen.queryByTestId("os-size-custom")).toBeNull();
    expect(screen.queryByTestId("os-size-50x30")).toBeNull(); // the TEXT sticker has no 50×30 layout
    expect(screen.getByTestId("os-size-60x40")).toBeTruthy();
    expect(screen.getByTestId("os-custom-hidden")).toBeTruthy();
    expect(screen.getByTestId("os-text-path")).toBeTruthy();
  });
  it("Reset to recommended = all ON, 1×, Bold, QR ON", () => {
    const init = recommendedSettings({ w: 60, h: 40 });
    init.parts.name = { on: false, weight: "normal", scale: 0.6 }; init.qr = false;
    renderIt({ initial: init });
    fireEvent.click(screen.getByTestId("os-reset"));
    expect(screen.getByTestId("os-name-scale").textContent).toBe("1×");
    expect(screen.getByTestId("os-name-on").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("os-name-w-bold").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("os-qr-on").getAttribute("aria-pressed")).toBe("true");
  });
  it("test buttons print the draft on screen", () => {
    const { onTest } = renderIt();
    fireEvent.click(screen.getByTestId("os-comment-plus"));
    fireEvent.click(screen.getByTestId("os-test-zh"));
    expect(onTest.mock.calls[0][1]).toBe("zh");
    expect(onTest.mock.calls[0][2]).toBe(true); // not saved yet → the "tap Save" toast
    expect(onTest.mock.calls[0][0].parts.comment.scale).toBe(1.15);
  });
});
