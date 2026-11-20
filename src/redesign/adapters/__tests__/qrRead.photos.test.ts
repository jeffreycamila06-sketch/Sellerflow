// The QR reader on PHONE PHOTOS of real stickers (the app's own sticker drawing, the QR the printer prints),
// iPhone path (no BarcodeDetector). Each case runs main's reader (frozen copy, fixtures/qrDecode.main.ts) and
// the new one on the SAME photo through the same fake browser (createImageBitmap + a 2D canvas).
// Found on the owner's iPhone (Nov 20 2026): a photo of the label roll holds 2–3 stickers → main reads
// nothing; a sticker curved over the fingers → main reads nothing. The new reader: one QR → that QR;
// two different QRs → "many" (the screen says "2 stickers in the photo — show only one"); no QR → none.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { stickerImage, bend, roll, photo, photoFile, installFakeBrowser, type Rgba } from "./qrPhoto.harness";
import { decodeQrFromFile as mainDecode } from "./fixtures/qrDecode.main";

// The stronger reader's WebAssembly comes from the package itself (no web server in a test).
vi.mock("../qrWasm", async () => {
  const fs = await import("node:fs");
  const b = fs.readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
  return { zxingOverrides: () => ({ wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) };
});
import { readQrFromFile, type QrScanResult } from "../qrDecode";

const URL_A = "https://tiktok.com/@jhun.belle", URL_B = "https://tiktok.com/@maria_live";
type S = Awaited<ReturnType<typeof stickerImage>>;
let fb: ReturnType<typeof installFakeBrowser>;
const st: Record<string, S> = {};
beforeAll(async () => {
  fb = installFakeBrowser();
  for (const [k, size, handle, qr] of [
    ["A50", { w: 50, h: 30 }, "jhun.belle", true], ["B50", { w: 50, h: 30 }, "maria_live", true],
    ["A60", { w: 60, h: 40 }, "jhun.belle", true], ["B60", { w: 60, h: 40 }, "maria_live", true], ["C60", { w: 60, h: 40 }, "ana.reyes22", true],
    ["A100", { w: 100, h: 60 }, "jhun.belle", true], ["B100", { w: 100, h: 60 }, "maria_live", true],
    ["N60", { w: 60, h: 40 }, "jhun.belle", false], ["A40", { w: 40, h: 30 }, "jhun.belle", true],
  ] as const) st[k] = await stickerImage(size, handle, qr);
}, 60000);
afterAll(() => fb.restore());

const W = 4032, H = 3024, W48 = 8064, H48 = 6048;
const both = async (img: Rgba): Promise<{ main: string | null; neu: QrScanResult }> =>
  ({ main: await mainDecode(photoFile(img)), neu: await readQrFromFile(photoFile(img)) });
const passNames = (r: QrScanResult) => r.diag.passes.map((p) => p.pass);

describe("the real stickers", () => {
  it("every QR sticker prints 0.75 mm modules (6 dots); 40×30 prints NO QR at all (nothing to scan)", () => {
    for (const k of ["A50", "A60", "A100"]) expect(st[k].qrModDots).toBe(6);
    expect(st.A40.qrModDots).toBe(0);
  });
});

describe("ONE sticker in the photo — still read, and fast (one decode pass)", () => {
  for (const k of ["A50", "A60", "A100"]) it(`${k.slice(1)} sticker, 12 MP`, async () => {
    const { main, neu } = await both(photo(W, H, [{ img: st[k], cx: W / 2, cy: H / 2, pxPerDot: 2.5, rotDeg: 3 }], { blur: 1 }));
    expect(main).toBe(URL_A); // main read it too (control)
    expect(neu.kind).toBe("one");
    expect(neu.kind === "one" && neu.text).toBe(URL_A);
    expect(passNames(neu)).toEqual(["zxing_load", "whole"]); // nothing after the first hit
    expect(neu.diag.decoder).toBe("zxing");
  }, 30000);
});

describe("TWO stickers on the roll (one above the other) — main: nothing; new: 2 stickers", () => {
  for (const [a, b] of [["A50", "B50"], ["A60", "B60"], ["A100", "B100"]]) it(`${a.slice(1)} stickers, 12 MP`, async () => {
    const { main, neu } = await both(photo(W, H, [{ img: roll([st[a], st[b]]), cx: W / 2, cy: H / 2, pxPerDot: 2.5, rotDeg: 4 }], { blur: 1 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "many", count: 2 });
  }, 30000);
  it("60×40 stickers, 48 MP photo", async () => {
    const { main, neu } = await both(photo(W48, H48, [{ img: roll([st.A60, st.B60]), cx: W48 * 0.45, cy: H48 * 0.55, pxPerDot: 4.5, rotDeg: 7 }], { blur: 2 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "many", count: 2 });
    expect(neu.diag.imgW).toBe(W48);
  }, 90000);
});

describe("TWO stickers side by side — main: guesses one buyer; new: 2 stickers (never a guess)", () => {
  it("60×40 stickers, 12 MP", async () => {
    const { main, neu } = await both(photo(W, H, [{ img: roll([st.A60, st.B60], 24, true), cx: W / 2, cy: H / 2, pxPerDot: 2.6, rotDeg: -2 }], { blur: 1 }));
    expect([URL_A, URL_B]).toContain(main); // main returns ONE of the two — the seller can't tell which
    expect(neu).toMatchObject({ kind: "many", count: 2 });
  }, 30000);
});

describe("THREE stickers on the roll, the 3rd curved over the fingers — main: nothing; new: 2+ stickers", () => {
  it("60×40 stickers, 12 MP", async () => {
    const img = photo(W, H, [
      { img: roll([st.A60, st.B60]), cx: W * 0.42, cy: H * 0.5, pxPerDot: 2.2, rotDeg: 90 },
      { img: bend(st.C60, 0.5), cx: W * 0.85, cy: H * 0.5, pxPerDot: 2.2, rotDeg: 95, tiltXDeg: 20 },
    ], { blur: 1 });
    const { main, neu } = await both(img);
    expect(main).toBeNull();
    expect(neu.kind).toBe("many");
    expect(neu.kind === "many" && neu.count).toBeGreaterThanOrEqual(2);
  }, 30000);
});

describe("ONE sticker, curved / tilted — main: nothing; new: read", () => {
  it("curved: the QR on the steep side of the bend, 12 MP", async () => {
    const { main, neu } = await both(photo(W, H, [{ img: bend(st.A60, 0.5), cx: W / 2, cy: H / 2, pxPerDot: 3, rotDeg: 6 }], { blur: 1 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "one", text: URL_A });
    expect(passNames(neu)).toEqual(["zxing_load", "whole"]); // read in the first pass (the photo at 2400 px)
  }, 30000);
  it("curved and tilted 30°, 12 MP", async () => {
    const { main, neu } = await both(photo(W, H, [{ img: bend(st.A60, 0.5), cx: W / 2, cy: H / 2, pxPerDot: 3, rotDeg: 8, tiltXDeg: 30 }], { blur: 1 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "one", text: URL_A });
  }, 30000);
  it("curved and tilted 30°, 48 MP", async () => {
    const { main, neu } = await both(photo(W48, H48, [{ img: bend(st.A60, 0.5), cx: W48 / 2, cy: H48 / 2, pxPerDot: 6, rotDeg: 8, tiltXDeg: 30 }], { blur: 2 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "one", text: URL_A });
  }, 90000);
});

describe("a sticker small in a 48 MP photo — the parts of the photo find what the whole photo cannot", () => {
  it("two stickers, ~6% of the photo's width each", async () => {
    const { main, neu } = await both(photo(W48, H48, [{ img: roll([st.A60, st.B60]), cx: W48 * 0.3, cy: H48 * 0.6, pxPerDot: 0.8, rotDeg: 10 }], { blur: 2 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "many", count: 2 });
    const found = neu.diag.passes.filter((p) => p.found > 0).map((p) => p.pass);
    expect(found).toEqual(["quadrants"]); // the whole photo and the halves/thirds found nothing
  }, 120000);
});

describe("NO QR in the photo — stays 'No QR found', with its reason", () => {
  it("a sticker printed without a QR, 12 MP: every pass tried, reason no_code", async () => {
    const { main, neu } = await both(photo(W, H, [{ img: st.N60, cx: W / 2, cy: H / 2, pxPerDot: 3 }], { blur: 1 }));
    expect(main).toBeNull();
    expect(neu).toMatchObject({ kind: "none", reason: "no_code" });
    expect(passNames(neu)).toEqual(["zxing_load", "whole", "halves", "thirds", "quadrants"]);
  }, 60000);
  it("the canvas never holds more than 2400 px on the long edge (iPhone's canvas limit is ~16.7 MP)", () => {
    expect(fb.stats.maxCanvasPx).toBeLessThanOrEqual(2400 * 2400); // 5.8 MP at most, also for the 48 MP photos
  });
});
