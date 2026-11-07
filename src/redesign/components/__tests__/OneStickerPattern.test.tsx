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
    expect(screen.getByTestId("os-row-shop").textContent).toContain("Not on 50×30");
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
    fireEvent.click(screen.getByTestId("os-size-50x30"));
    expect(screen.queryByTestId("os-too-wide")).toBeNull();
  });
  it("a printer on the older text sticker: Custom is hidden with a short note", () => {
    renderIt({ devicePath: "text" });
    expect(screen.queryByTestId("os-size-custom")).toBeNull();
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
    expect(onTest.mock.calls[0][0].parts.comment.scale).toBe(1.15);
  });
});
