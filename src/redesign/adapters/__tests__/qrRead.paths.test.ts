// The QR reader's other paths: the stronger reader can't load → jsQR (still "2 stickers", never a guess);
// the phone's own reader (Android BarcodeDetector) first; why "No QR found" (image / canvas / decoder /
// no code); the scan event never carries the QR text; the stronger reader loads only on tap, only where
// the phone has no reader of its own.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { stickerImage, roll, photo, photoFile, installFakeBrowser, type Rgba } from "./qrPhoto.harness";

const z = vi.hoisted(() => ({ overrides: vi.fn((): unknown => { throw new Error("WebAssembly could not load"); }), track: vi.fn() }));
vi.mock("../qrWasm", () => ({ zxingOverrides: () => z.overrides() }));
vi.mock("../../analytics", () => ({ track: (...a: unknown[]) => z.track(...a) }));
import { readQrFromFile, judge, warmQrReader, decodeQrFromFile } from "../qrDecode";

const URL_A = "https://tiktok.com/@jhun.belle", URL_B = "https://tiktok.com/@maria_live";
const W = 2016, H = 1512; // a smaller photo: these tests are about the paths, not the size
let fb: ReturnType<typeof installFakeBrowser>;
let one: Rgba, two: Rgba, none: Rgba;
beforeAll(async () => {
  fb = installFakeBrowser();
  const A = await stickerImage({ w: 60, h: 40 }, "jhun.belle"), B = await stickerImage({ w: 60, h: 40 }, "maria_live");
  const N = await stickerImage({ w: 60, h: 40 }, "x", false);
  one = photo(W, H, [{ img: A, cx: W / 2, cy: H / 2, pxPerDot: 1.4, rotDeg: 3 }], { blur: 1 });
  two = photo(W, H, [{ img: roll([A, B]), cx: W / 2, cy: H / 2, pxPerDot: 1.4, rotDeg: 4 }], { blur: 1 });
  none = photo(1600, 1200, [{ img: N, cx: 800, cy: 600, pxPerDot: 1 }], { blur: 1 });
}, 60000);
afterAll(() => fb.restore());
afterEach(() => { delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector; z.track.mockClear(); });

describe("judge — what a set of codes means", () => {
  it("none · one · the same sticker twice = one · two different = many", () => {
    expect(judge([])).toEqual({ kind: "none" });
    expect(judge(["", ""])).toEqual({ kind: "none" });
    expect(judge([URL_A])).toEqual({ kind: "one", text: URL_A });
    expect(judge([URL_A, URL_A, ""])).toEqual({ kind: "one", text: URL_A });
    expect(judge([URL_A, URL_B, URL_A])).toEqual({ kind: "many", count: 2 });
  });
});

describe("the stronger reader cannot load (old phone, no network) → jsQR, same answers", () => {
  it("one sticker → read by jsQR's quick pass", async () => {
    const r = await readQrFromFile(photoFile(one));
    expect(r).toMatchObject({ kind: "one", text: URL_A });
    expect(r.diag.decoder).toBe("jsqr");
    expect(r.diag.passes.map((p) => p.pass)).toEqual(["zxing_unavailable", "quick", "confirm"]); // one jsQR hit is checked against the halves
  }, 30000);
  it("two stickers on the roll → 2 stickers (the parts of the photo find each one) — never a guess", async () => {
    const r = await readQrFromFile(photoFile(two));
    expect(r).toMatchObject({ kind: "many", count: 2 });
    expect(r.diag.decoder).toBe("jsqr");
  }, 60000);
  it("decodeQrFromFile (kept for older callers): the one text, else null — also null for 2 stickers", async () => {
    expect(await decodeQrFromFile(photoFile(one))).toBe(URL_A);
    expect(await decodeQrFromFile(photoFile(two))).toBeNull();
  }, 60000);
});

describe("the phone's own reader (Android / Chrome) comes first", () => {
  const install = (codes: string[]) => {
    const detect = vi.fn(async () => codes.map((rawValue) => ({ rawValue })));
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class { detect = detect; };
    return detect;
  };
  it("it sees two codes → 2 stickers; the stronger reader is never loaded", async () => {
    z.overrides.mockClear();
    const detect = install([URL_A, URL_B]);
    const r = await readQrFromFile(photoFile(one));
    expect(r).toMatchObject({ kind: "many", count: 2 });
    expect(r.diag.decoder).toBe("native");
    expect(detect).toHaveBeenCalledTimes(1);
    expect(z.overrides).not.toHaveBeenCalled();
  });
  it("it sees one code → that code", async () => {
    install([URL_B]);
    expect(await readQrFromFile(photoFile(one))).toMatchObject({ kind: "one", text: URL_B });
  });
  it("it sees nothing → the other passes still run (here: jsQR reads the sticker)", async () => {
    install([]);
    const r = await readQrFromFile(photoFile(one));
    expect(r).toMatchObject({ kind: "one", text: URL_A });
    expect(r.diag.passes.map((p) => p.pass).slice(0, 2)).toEqual(["native", "zxing_unavailable"]);
  }, 30000);
});

describe("why 'No QR found' — the reason is recorded, never the QR text", () => {
  it("no QR in the photo → no_code", async () => {
    expect(await readQrFromFile(photoFile(none))).toMatchObject({ kind: "none", reason: "no_code" });
  }, 60000);
  it("the photo cannot be opened → image_unreadable (no pass runs)", async () => {
    fb.restore();
    const bad = installFakeBrowser({ bitmapFails: true });
    try {
      const r = await readQrFromFile(photoFile(one));
      expect(r).toMatchObject({ kind: "none", reason: "image_unreadable" });
      expect(r.diag.passes).toEqual([]);
    } finally { bad.restore(); fb = installFakeBrowser(); }
  });
  it("no drawing surface (out of memory) → canvas_failed", async () => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const keep = proto.getContext;
    proto.getContext = () => null;
    try { expect(await readQrFromFile(photoFile(one))).toMatchObject({ kind: "none", reason: "canvas_failed" }); }
    finally { proto.getContext = keep; }
  });
  it("one event per scan: result, reason, sizes, times — no QR text, no username", async () => {
    z.track.mockClear();
    await readQrFromFile(photoFile(one));
    await readQrFromFile(photoFile(two));
    await readQrFromFile(photoFile(none));
    expect(z.track).toHaveBeenCalledTimes(3);
    const events = z.track.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(z.track.mock.calls.every((c) => c[0] === "qr_scan")).toBe(true);
    expect(events.map((e) => [e.result, e.reason])).toEqual([["one", null], ["many", null], ["none", "no_code"]]);
    expect(events[0]).toMatchObject({ decoder: "jsqr", img_w: W, img_h: H, file_type: "image/jpeg" });
    const all = JSON.stringify(events);
    for (const secret of ["tiktok", "jhun", "maria", "http"]) expect(all).not.toContain(secret);
  }, 90000);
});

describe("the stronger reader loads only when Scan is tapped, only without the phone's own reader", () => {
  it("no BarcodeDetector (iPhone): Scan starts loading it", async () => {
    z.overrides.mockClear();
    warmQrReader();
    await vi.waitFor(() => expect(z.overrides).toHaveBeenCalled());
  });
  it("BarcodeDetector present (Android): Scan loads nothing", async () => {
    z.overrides.mockClear();
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class { detect = async () => []; };
    warmQrReader();
    await new Promise((r) => setTimeout(r, 30));
    expect(z.overrides).not.toHaveBeenCalled();
  });
});
