// BLOCKING BUG (Jeff 2026-11-10): the QR came back ON after a Change round trip.
// Saved: QR ON at 100×60 → Change → Printer settings Custom 40×30 (saved QR OFF — right) → pick 100×60 → Back.
// The Live print pattern showed the QR switch ON and Save stored qr: true, because the unsaved draft (osDraft) still
// had the QR on. The QR must never come back by itself: the draft follows the same rule as the saved sticker
// (osDraftAfterSizePick in RedesignApp.onPickOneSize — a listed size and Custom → Save size both go there).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings, type OneStickerSettings } from "../../adapters/oneSticker";
import { saveOneSticker, readSavedOneSticker, pickOneStickerSize, osDraftAfterSizePick, __resetOneStickerState } from "../../adapters/oneStickerPrint";
import { TProvider } from "../../i18n";

afterEach(() => { localStorage.clear(); __resetOneStickerState(); });

type Size = { w: number; h: number; custom?: boolean };
/** One visit to the Live print pattern, as RedesignApp mounts it (initial = the saved sticker, size = Printer settings). */
function visit(draft: OneStickerSettings | null, size: Size) {
  const onSave = vi.fn(), onDraft = vi.fn();
  const r = render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={readSavedOneSticker()!} size={size} draft={draft} onDraft={onDraft} savedOnDevice onSave={onSave}
    shopName="Maria Ukay" devicePath="d520" printerName="D520BT-Z" qrAllowed onTest={() => {}} onChangeSize={() => {}} /></TProvider>);
  return { onSave, lastDraft: () => onDraft.mock.calls.at(-1)![0] as OneStickerSettings, unmount: r.unmount };
}
/** A pick in Printer settings, as RedesignApp.onPickOneSize does it (saved sticker + the kept draft). */
function pick(draft: OneStickerSettings | null, w: number, h: number): { draft: OneStickerSettings | null; size: Size } {
  const r = pickOneStickerSize(w, h)!;
  return { draft: osDraftAfterSizePick(draft, r.size), size: r.size };
}

describe("QR never comes back after a Change round trip", () => {
  for (const [name, small] of [["Custom 40×30 → 100×60", [40, 30]], ["Custom 45×40 (narrower than 50) → 100×60", [45, 40]]] as const) {
    it(name, () => {
      saveOneSticker({ ...recommendedSettings({ w: 100, h: 60 }), qr: true });
      const a = visit(null, { w: 100, h: 60 });
      expect(screen.getByTestId("os-qr-on").getAttribute("aria-checked")).toBe("true");
      const draft0 = a.lastDraft();
      expect(draft0.qr).toBe(true);
      a.unmount(); // Change → Printer settings
      let p = pick(draft0, small[0], small[1]); // Custom → Save size
      expect(readSavedOneSticker()!.qr).toBe(false);
      p = pick(p.draft, 100, 60); // then a listed size
      expect(readSavedOneSticker()!.qr).toBe(false);
      const b = visit(p.draft, p.size); // Back
      const sw = screen.getByTestId("os-qr-on") as HTMLButtonElement;
      expect(sw.disabled).toBe(false); // 100×60 takes a QR again…
      expect(sw.getAttribute("aria-checked")).toBe("false"); // …but it is NOT turned back on
      fireEvent.click(screen.getByTestId("os-name-w-extra")); // any edit, then Save
      fireEvent.click(screen.getByTestId("os-save"));
      expect(b.onSave.mock.calls[0][0].qr).toBe(false);
    });
  }
  it("a listed size only (never below 50×30): the QR stays ON", () => {
    saveOneSticker({ ...recommendedSettings({ w: 100, h: 60 }), qr: true });
    const a = visit(null, { w: 100, h: 60 });
    const draft0 = a.lastDraft();
    a.unmount();
    const p = pick(draft0, 60, 40);
    visit(p.draft, p.size);
    expect(screen.getByTestId("os-qr-on").getAttribute("aria-checked")).toBe("true");
  });
  it("nothing saved yet (laptop): a Custom below 50×30 also turns the draft's QR off for good", () => {
    localStorage.clear(); __resetOneStickerState();
    const d = { ...recommendedSettings({ w: 100, h: 60 }), qr: true };
    expect(osDraftAfterSizePick(d, { w: 40, h: 30 })!.qr).toBe(false);
    expect(osDraftAfterSizePick(osDraftAfterSizePick(d, { w: 40, h: 30 }), { w: 100, h: 60 })!.qr).toBe(false);
    expect(osDraftAfterSizePick(d, { w: 50, h: 30 })).toBe(d); // 50×30 itself keeps it
    expect(osDraftAfterSizePick(null, { w: 40, h: 30 })).toBeNull();
  });
  it("RedesignApp: every Printer settings pick (listed size and Custom → Save size) updates the kept draft", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toMatch(/const r = pickOneStickerSize\(w, h\);[^\n]*\n\s*if \(!r\) return;[\s\S]{0,300}setOsDraft\(\(d\) => osDraftAfterSizePick\(d, r\.size\)\);/);
    expect(app).toContain("onPick: onPickOneSize");
    const ps = fs.readFileSync("src/redesign/screens/PrinterSettings.tsx", "utf8");
    expect(ps).toContain("oneSize.onPick(z.w, z.h)"); // a listed size
    expect(ps).toContain("oneSize.onPick(cw, ch)");   // Custom → Save size
  });
});
