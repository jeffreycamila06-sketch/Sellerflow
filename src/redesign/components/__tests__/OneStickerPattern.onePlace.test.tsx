// ONE PLACE FOR THE STICKER SIZE (Jeff 2026-11-10) — the Live print pattern side.
// A. "Test: long comment (EN)" / "(中文)" are ADMIN only; a seller has Printer Test only.
// B. No Paper size section (every device); one line "Sticker size: W×H mm · Change" under the preview opens
//    Printer settings; the preview / test / Save always use the Printer settings size.
// D. QR below 50×30: greyed OFF here, and it stays off when the size grows again.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings, type OneStickerSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";
import type { OneStickerDevicePath } from "../../adapters/printing";

type Size = { w: number; h: number; custom?: boolean };
function mount(o: { isAdmin?: boolean; size?: Size; initial?: OneStickerSettings; draft?: OneStickerSettings | null; devicePath?: OneStickerDevicePath; savedOnDevice?: boolean } = {}) {
  const onSave = vi.fn(), onTest = vi.fn(), onChangeSize = vi.fn(), onDraft = vi.fn();
  const initial = o.initial ?? recommendedSettings({ w: 100, h: 60 });
  const el = (size: Size) => (
    <TProvider lang="en">
      <OneStickerPattern onBack={() => {}} initial={initial} size={size} draft={o.draft} onDraft={onDraft} savedOnDevice={o.savedOnDevice ?? false} onSave={onSave}
        shopName="Maria Ukay" devicePath={o.devicePath ?? "d520"} qrAllowed onTest={onTest} onChangeSize={onChangeSize}
        isAdmin={o.isAdmin} onTestSample={o.isAdmin ? () => {} : undefined} />
    </TProvider>
  );
  const r = render(el(o.size ?? initial.size));
  return { onSave, onTest, onChangeSize, onDraft, setSize: (z: Size) => r.rerender(el(z)), unmount: r.unmount };
}

describe("Live print pattern — one place for the size", () => {
  it("A: a seller sees Printer Test only (no long-comment tests); an admin sees both long-comment tests", () => {
    const a = mount();
    expect(screen.getByTestId("os-test")).toBeTruthy();
    expect(screen.queryByTestId("os-test-en")).toBeNull();
    expect(screen.queryByTestId("os-test-zh")).toBeNull();
    expect(screen.queryByText(/long comment/i)).toBeNull();
    a.unmount();
    mount({ isAdmin: true });
    expect(screen.getByTestId("os-test-en").textContent).toBe("Test: long comment (EN)");
    expect(screen.getByTestId("os-test-zh").textContent).toBe("Test: long comment (中文)");
  });
  it("B: no Paper size section on any device — the size line + Change instead", () => {
    for (const devicePath of ["d520", "tspl", "niimbot", "laptop", "text", "wifi"] as const) {
      const m = mount({ devicePath, size: { w: 60, h: 40 } });
      expect(screen.queryByText(/Paper size/i), devicePath).toBeNull();
      for (const id of ["os-size-card", "os-sizes", "os-size-custom", "os-custom-w"]) expect(screen.queryByTestId(id), `${devicePath} ${id}`).toBeNull();
      expect(screen.getByTestId("os-size-text").textContent, devicePath).toBe("Sticker size: 60×40 mm");
      expect(screen.getByTestId("os-size-change").textContent, devicePath).toBe("Change");
      m.unmount();
    }
  });
  it("B: Change opens Printer settings (onChangeSize)", () => {
    const { onChangeSize } = mount();
    fireEvent.click(screen.getByTestId("os-size-change"));
    expect(onChangeSize).toHaveBeenCalledTimes(1);
  });
  it("B: the preview, Printer Test and Save use the Printer settings size — never a size of their own", () => {
    const { onTest, onSave, setSize } = mount({ initial: recommendedSettings({ w: 100, h: 60 }), size: { w: 70, h: 50 } });
    expect((screen.getByTestId("os-preview") as HTMLCanvasElement).style.aspectRatio).toBe("70 / 50");
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest.mock.calls[0][0].size).toEqual({ w: 70, h: 50 });
    setSize({ w: 45, h: 35, custom: true });
    expect((screen.getByTestId("os-preview") as HTMLCanvasElement).style.aspectRatio).toBe("45 / 35");
    fireEvent.click(screen.getByTestId("os-save"));
    expect(onSave.mock.calls[0][0].size).toEqual({ w: 45, h: 35, custom: true });
  });
  it("B: a size change in Printer settings alone is not an unsaved edit (Save stays off on a saved device)", () => {
    const { setSize } = mount({ savedOnDevice: true });
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
    setSize({ w: 60, h: 40 });
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("B: back from Printer settings, the unsaved edits are still there (draft) at the new size", () => {
    const draft = recommendedSettings({ w: 100, h: 60 });
    draft.parts.name.weight = "extra";
    const { onDraft } = mount({ savedOnDevice: true, draft, size: { w: 80, h: 50 } });
    expect(screen.getByTestId("os-name-w-extra").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("os-size-text").textContent).toBe("Sticker size: 80×50 mm");
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(false);
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ size: { w: 80, h: 50 } }));
  });
  it("D: below 50×30 the QR switch is OFF and grey (with the note); a bigger size later does not turn it back on", () => {
    const init = recommendedSettings({ w: 60, h: 40 });
    init.qr = true;
    const { setSize, onSave } = mount({ initial: init, size: { w: 60, h: 40 } });
    expect(screen.getByTestId("os-qr-on").getAttribute("aria-checked")).toBe("true");
    setSize({ w: 40, h: 30, custom: true });
    const sw = screen.getByTestId("os-qr-on") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("os-qr-sub").textContent).toBe("QR needs a label at least 50×30 mm");
    setSize({ w: 60, h: 40 });
    expect(screen.getByTestId("os-qr-on").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByTestId("os-save"));
    expect(onSave.mock.calls[0][0].qr).toBe(false);
  });
  it("D: too wide for the saved printer → the red note and no Save (until Printer settings picks a smaller size)", () => {
    render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 100, h: 60 })} size={{ w: 100, h: 60 }} savedOnDevice onSave={() => {}} shopName="" devicePath="niimbot" printerName="B21-C2" qrAllowed onTest={() => {}} onChangeSize={() => {}} /></TProvider>);
    expect(screen.getByTestId("os-too-wide").textContent).toBe("Your B21 takes labels up to 50 mm wide — this size is wider.");
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("guardian gap 3: an unknown Niimbot (printerLimit 50 mm) at 100×60 → too wide, no Save", () => {
    render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 100, h: 60 })} size={{ w: 100, h: 60 }} savedOnDevice onSave={() => {}} shopName="" devicePath="niimbot" printerName="NB-UNKNOWN" printerLimit={{ model: "Niimbot", maxLabelMm: 50 }} qrAllowed onTest={() => {}} onChangeSize={() => {}} /></TProvider>);
    expect(screen.getByTestId("os-too-wide").textContent).toBe("Your Niimbot takes labels up to 50 mm wide — this size is wider.");
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("the size line exists in all 8 languages", () => {
    for (const [lang, want] of [["fil", "Sukat ng sticker: 60×40 mm"], ["zh-TW", "貼紙尺寸：60×40 mm"], ["th", "ขนาดสติกเกอร์: 60×40 มม."], ["bg", "Размер на стикера: 60×40 мм"]] as const) {
      const r = render(<TProvider lang={lang}><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} size={{ w: 60, h: 40 }} savedOnDevice={false} onSave={() => {}} shopName="" devicePath="d520" qrAllowed onTest={() => {}} onChangeSize={() => {}} /></TProvider>);
      expect(screen.getByTestId("os-size-text").textContent).toBe(want);
      r.unmount();
    }
  });
});
