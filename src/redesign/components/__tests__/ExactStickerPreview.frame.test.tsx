// Round 3 (item 1): on a laptop the preview draws the print bitmap at the label's REAL size (mm → CSS px) and
// scales it into the frame with a CSS transform — the picture is the printed page whatever the frame's width.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import ExactStickerPreview from "../ExactStickerPreview";
import { labelPx, MM_TO_PX } from "../../adapters/stickerPreview";
import { DEF_SETTINGS } from "../../adapters/printing";

const widths = [311, 560, 900];
afterEach(() => vi.restoreAllMocks());
describe("ExactStickerPreview — laptop frame", () => {
  for (const w of widths) {
    it(`frame ${w}px: the canvas is 60mm × 40mm, scaled by ${w} / (60mm in px); its source is the same bitmap`, () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return { width: this.getAttribute("data-testid") === "pp-exact-preview-browser" ? w : 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
      });
      const v = render(<ExactStickerPreview settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} cur="NT$" shopName="My Shop" browser />);
      const frame = v.getByTestId("pp-exact-preview-browser");
      const canvas = v.getByTestId("pp-exact-preview") as HTMLCanvasElement;
      const px = labelPx(60, 40);
      expect(px.w).toBeCloseTo(60 * MM_TO_PX, 6);
      expect(frame.getAttribute("data-label-px")).toBe(`${px.w.toFixed(2)}x${px.h.toFixed(2)}`);
      expect(frame.getAttribute("data-scale")).toBe((w / px.w).toFixed(4));
      expect(canvas.style.width).toBe("60mm");
      expect(canvas.style.height).toBe("40mm");
      expect(canvas.style.transform).toBe(`scale(${w / px.w})`);
      expect(canvas.style.transformOrigin).toBe("top left");
      expect(canvas.getAttribute("data-path")).toBe("browser"); // drawn from stickerBitmapFor({ path: "browser" }) — the print's own image
      v.unmount();
    });
  }
  it("mm → px uses the CSS reference pixel (96 per inch)", () => {
    expect(MM_TO_PX).toBeCloseTo(3.7795, 3);
    expect(labelPx(100, 60)).toEqual({ w: 100 * MM_TO_PX, h: 60 * MM_TO_PX });
  });
});
