// warmQrPixelReader — the in-page scanner calls it the moment it OPENS (before the camera has answered):
// the reader of readQrHitsFromPixels starts loading at once, nothing is read, and the first camera frame
// then uses that same reader (no second load).
import { describe, it, expect, vi } from "vitest";

const asked = vi.hoisted(() => ({ n: 0 }));
vi.mock("../qrWasm", async () => {
  const fs = await import("node:fs");
  const b = fs.readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
  return { zxingOverrides: () => { asked.n++; return { wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } };
});
vi.mock("../../analytics", () => ({ track: vi.fn() }));
import { readQrHitsFromPixels, warmQrPixelReader } from "../qrDecode";

const until = async (ok: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error("waited too long"); await new Promise((r) => setTimeout(r, 5)); }
};

describe("warmQrPixelReader — the reader starts loading when the scanner opens", () => {
  it("one call starts the load (the reader's file is asked for); more calls start nothing new; the first frame uses that reader", async () => {
    expect(asked.n).toBe(0);                       // nothing is loaded just by opening the app
    expect(() => warmQrPixelReader()).not.toThrow();
    await until(() => asked.n === 1);              // the load has begun — no frame was read
    warmQrPixelReader();
    warmQrPixelReader();
    const blank = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
    expect(await readQrHitsFromPixels(blank)).toEqual([]); // the reader is there (not null = "no reader")
    expect(asked.n).toBe(1);                       // …and it is the one that was started at open
  }, 30000);
});
