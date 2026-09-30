// "Print QR on sticker" moves to LIVE print pattern — ADMINS ONLY (the LIVE layout v2
// gate). Everyone else keeps it in Printer settings exactly as today. Same storage key,
// same default OFF, same market gate, same 60×40 rule; print-time entitlement unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import PrinterSettings from "../PrinterSettings";
import { LS_STICKER_QR, DEF_SETTINGS, setStickerQrEntitled, stickerQrEffective, buildSettingsFromRedesign } from "../../adapters/printing";
import { previewPayload } from "../../adapters/stickerPreview";
import { stickerDrawOps, stickerQrPlacement, STICKER_LAYOUTS, QR_TEXT_KEEPOUT_GAP } from "../../adapters/stickerRaster";

beforeEach(() => { localStorage.clear(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); setStickerQrEntitled(false); });

const settings80x50 = buildSettingsFromRedesign({ pp: DEFAULT_PP, psType: "bt", psOut: "sticker", psSize: "80x50mm" });
const pattern = (p: Partial<Parameters<typeof PrintPattern>[0]> = {}) =>
  render(<TProvider lang="en"><PrintPattern onBack={() => {}} pp={DEFAULT_PP} onToggle={() => {}} onStep={() => {}} {...p} /></TProvider>);
const printer = (p: Partial<Parameters<typeof PrinterSettings>[0]> = {}) =>
  render(<TProvider lang="en"><PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="80x50mm" psSizeOpen={false} onTogglePsSize={() => {}} onPickPsSize={() => {}} stickerQrAllowed {...p} /></TProvider>);

describe("where the toggle lives", () => {
  it("non-admins (layout v2 off): still in Printer settings, NOT in LIVE print pattern", () => {
    expect(printer().getByTestId("ps-sticker-qr-toggle")).toBeTruthy();
    expect(pattern({ stickerQrAllowed: true }).queryByTestId("pp-sticker-qr-row")).toBeNull();
  });
  it("admins (layout v2 on): in LIVE print pattern, removed from Printer settings (no duplicate)", () => {
    expect(printer({ stickerQrMoved: true }).queryByTestId("ps-sticker-qr-toggle")).toBeNull();
    const v = pattern({ layoutV2: true, stickerQrAllowed: true });
    expect(v.getByTestId("pp-sticker-qr-row").textContent).toContain("Print QR on sticker");
  });
  it("sits right under the TikTok username row", () => {
    const v = pattern({ layoutV2: true, stickerQrAllowed: true });
    const row = v.getByTestId("pp-sticker-qr-row");
    expect(row.previousElementSibling?.textContent).toContain("TikTok username");
  });
  it("market gate unchanged: off-market → hidden in both places", () => {
    expect(printer({ stickerQrAllowed: false }).queryByTestId("ps-sticker-qr-toggle")).toBeNull();
    expect(pattern({ layoutV2: true, stickerQrAllowed: false }).queryByTestId("pp-sticker-qr-row")).toBeNull();
  });
});

describe("value + storage", () => {
  it("same key, same per-device value: a seller who had it ON stays ON; default OFF", () => {
    expect(pattern({ layoutV2: true, stickerQrAllowed: true }).getByTestId("pp-sticker-qr-toggle").getAttribute("aria-pressed")).toBe("false");
    localStorage.setItem(LS_STICKER_QR, "1");
    expect(pattern({ layoutV2: true, stickerQrAllowed: true }).getAllByTestId("pp-sticker-qr-toggle").pop()!.getAttribute("aria-pressed")).toBe("true");
  });
  it("toggling writes the same key Printer settings uses (on → '1', off → removed)", () => {
    const v = pattern({ layoutV2: true, stickerQrAllowed: true });
    fireEvent.click(v.getByTestId("pp-sticker-qr-toggle"));
    expect(localStorage.getItem(LS_STICKER_QR)).toBe("1");
    fireEvent.click(v.getByTestId("pp-sticker-qr-toggle"));
    expect(localStorage.getItem(LS_STICKER_QR)).toBeNull();
  });
  it("print-time entitlement still decides: a stored ON prints nothing when not entitled", () => {
    localStorage.setItem(LS_STICKER_QR, "1");
    setStickerQrEntitled(false);
    expect(stickerQrEffective()).toBe(false);
    setStickerQrEntitled(true);
    expect(stickerQrEffective()).toBe(true);
  });
  it("60×40 in the phone app: row disabled with the same note as Printer settings; web: no size gate (same rule)", () => {
    const app = pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "60x40mm", appShell: true });
    expect((app.getByTestId("pp-sticker-qr-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(app.getByTestId("pp-sticker-qr-hint").textContent).toBe("QR available on 70×50, 80×50, 80×60 only.");
    app.unmount();
    const web = pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "60x40mm", appShell: false });
    expect((web.getByTestId("pp-sticker-qr-toggle") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("preview", () => {
  const on = () => localStorage.setItem(LS_STICKER_QR, "1");
  it("QR on + a size with a QR → the exact sticker image replaces the mock", () => {
    on();
    const v = pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "80x50mm", appShell: true, previewSettings: settings80x50 });
    expect(v.getByTestId("pp-exact-preview")).toBeTruthy();
    expect(v.queryByTestId("pp-v2-comment")).toBeNull();
  });
  it("QR off, 60×40 (no QR on the phone), or @username off → the normal preview, no QR", () => {
    expect(pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "80x50mm", previewSettings: settings80x50 }).queryByTestId("pp-exact-preview")).toBeNull();
    on();
    expect(pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "60x40mm", appShell: true, previewSettings: settings80x50 }).queryByTestId("pp-exact-preview")).toBeNull();
    expect(pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "60x40mm", appShell: false, previewSettings: settings80x50 }).queryByTestId("pp-exact-preview")).toBeNull();
    expect(pattern({ layoutV2: true, stickerQrAllowed: true, psSize: "80x50mm", previewSettings: settings80x50, pp: { ...DEFAULT_PP, tiktokUser: false } }).queryByTestId("pp-exact-preview")).toBeNull();
  });
  it("the preview image is the real print layout: QR at the real placement, comment rows stop left of it", () => {
    for (const size of ["70x50", "80x50", "80x60"]) {
      const s = buildSettingsFromRedesign({ pp: DEFAULT_PP, psType: "bt", psOut: "sticker", psSize: `${size}mm` });
      const { payload, w, h } = previewPayload(s, "NT$", "Budgetukay2", true);
      const qr = stickerQrPlacement(payload, STICKER_LAYOUTS[size].wDots, h * 8, h)!;
      expect(qr).not.toBeNull();
      expect(qr.x0 + qr.foot).toBe(STICKER_LAYOUTS[size].wDots - 8); // bottom-right, 1 mm from the edge
      const ops = stickerDrawOps(payload, w, h, "extended", qr).ops;
      for (const o of ops.filter((x) => x.k === "cjk")) {
        if (o.y + 24 * o.ym > qr.y0 - QR_TEXT_KEEPOUT_GAP) expect(o.x + [...o.s].length * 24 * o.xm).toBeLessThanOrEqual(qr.x0 - QR_TEXT_KEEPOUT_GAP);
      }
    }
    expect(DEF_SETTINGS.printBuyerUsername).toBe(true);
  });
});
