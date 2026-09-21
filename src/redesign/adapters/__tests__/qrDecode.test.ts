// QR decode adapter — pure bits: downscale math + the jsQR pixel path (BarcodeDetector
// is browser-only, exercised via the canvas entrypoints which jsdom can't run; the
// pixel decode + fitDims are the testable core). jsQR is mocked (no real decode needed).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { jsQRmock } = vi.hoisted(() => ({ jsQRmock: vi.fn() }));
vi.mock("jsqr", () => ({ default: jsQRmock }));

import { fitDims, decodePixels } from "../qrDecode";

beforeEach(() => { jsQRmock.mockReset(); });

describe("fitDims — downscale to ~1000px long edge, never upscale", () => {
  it("small images pass through unchanged", () => {
    expect(fitDims(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitDims(1000, 400)).toEqual({ w: 1000, h: 400 });
  });
  it("large images scale so the long edge = 1000, aspect kept", () => {
    expect(fitDims(3000, 2000)).toEqual({ w: 1000, h: 667 });
    expect(fitDims(2000, 4000)).toEqual({ w: 500, h: 1000 });
  });
  it("degenerate sizes never divide-by-zero / never go below 1px", () => {
    expect(fitDims(0, 0)).toEqual({ w: 0, h: 0 });
    expect(fitDims(5000, 1)).toEqual({ w: 1000, h: 1 });
  });
});

describe("decodePixels — jsQR path, verbatim string", () => {
  const px = (n = 16) => new Uint8ClampedArray(n * 4);
  it("returns the decoded handle VERBATIM (tags/underscore/case preserved)", async () => {
    jsQRmock.mockReturnValue({ data: "Ashley102031(IG)" });
    expect(await decodePixels(px(), 4, 4)).toBe("Ashley102031(IG)");
    jsQRmock.mockReturnValue({ data: "buyer.99_x" });
    expect(await decodePixels(px(), 4, 4)).toBe("buyer.99_x");
  });
  it("no QR (jsQR → null) → null", async () => {
    jsQRmock.mockReturnValue(null);
    expect(await decodePixels(px(), 4, 4)).toBeNull();
  });
  it("empty jsQR string → null (never an empty handle)", async () => {
    jsQRmock.mockReturnValue({ data: "" });
    expect(await decodePixels(px(), 4, 4)).toBeNull();
  });
  it("zero dimensions → null, jsQR not called", async () => {
    expect(await decodePixels(px(), 0, 0)).toBeNull();
    expect(jsQRmock).not.toHaveBeenCalled();
  });
  it("a jsQR throw is swallowed → null (never breaks the capture flow)", async () => {
    jsQRmock.mockImplementation(() => { throw new Error("boom"); });
    expect(await decodePixels(px(), 4, 4)).toBeNull();
  });
});
