// Receipt format — Payment QR picture (Nov 12 2026).
//   • preview: a 160 × 160 white box (= the product edit dialog picture), the WHOLE QR (contain —
//     never cover, never cropped: a cut QR can't be scanned); buttons beside it, wrapping below on a
//     narrow phone; tapping the box = Choose picture;
//   • upload: downscaleQrFile goes through the product-picture helper (decodeUpright: EXIF turn,
//     HEIC) BEFORE the unchanged ≤ 600 px / PNG-first / under-cap encoding; the whole picture is drawn.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  qr: "data:image/png;base64,QRQR" as string | null,
  decode: vi.fn(),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  saveReceiptSettings: vi.fn(async () => true),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: h.qr } })),
}));
vi.mock("../../adapters/productImages", async (orig) => ({
  ...(await orig<typeof import("../../adapters/productImages")>()),
  decodeUpright: h.decode,
}));

import { TProvider } from "../../i18n";
import ReceiptFormat from "../ReceiptFormat";
import { downscaleQrFile, QR_MAX_SIDE, QR_DATA_URL_CAP } from "../../adapters/receiptSettings";

beforeEach(() => {
  h.qr = "data:image/png;base64,QRQR";
  h.decode.mockReset();
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom: no canvas → sample picture quietly "failed"
});
const screen = () => render(<TProvider lang="en"><ReceiptFormat cur="NT$" onBack={() => {}} /></TProvider>);
const st = (el: Element) => (el as HTMLElement).style;

describe("QR preview", () => {
  it("160 × 160 white box, the whole QR (contain), same border/radius style", async () => {
    const { findByTestId } = screen();
    const img = await findByTestId("rc-qr-thumb");
    const box = img.parentElement as HTMLElement;
    expect(box.getAttribute("data-testid")).toBe("rc-qr-box");
    expect([st(box).width, st(box).height, st(box).background, st(box).borderRadius, st(box).border]).toEqual(["160px", "160px", "rgb(255, 255, 255)", "14px", "1px solid var(--border)"]);
    expect([st(img).objectFit, st(img).width, st(img).height]).toEqual(["contain", "100%", "100%"]);
    expect(img.getAttribute("src")).toBe("data:image/png;base64,QRQR");
  });
  it("never cover / crop anywhere on the screen", async () => {
    const { findByTestId, container } = screen();
    await findByTestId("rc-qr-thumb");
    for (const el of Array.from(container.querySelectorAll("img"))) expect((el as HTMLElement).style.objectFit).not.toBe("cover");
    const src = readFileSync("src/redesign/screens/ReceiptFormat.tsx", "utf8");
    expect(src).not.toMatch(/objectFit:\s*"cover"/);
  });
  it("buttons sit beside the box and wrap below it on a narrow phone; tapping the box opens Choose picture", async () => {
    const { findByTestId, getByTestId } = screen();
    await findByTestId("rc-qr-thumb");
    expect(st(getByTestId("rc-qr-row")).flexWrap).toBe("wrap");
    const actions = getByTestId("rc-qr-actions");
    expect(st(actions).flexDirection).toBe("column");
    expect(Array.from(actions.children).map((b) => b.textContent)).toEqual(["Choose picture", "Remove"]);
    const file = getByTestId("rc-qr-file") as HTMLInputElement;
    const click = vi.spyOn(file, "click");
    fireEvent.click(getByTestId("rc-qr-box"));
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("no QR yet → no box, just Choose picture (as before)", async () => {
    h.qr = null;
    const { findByText, queryByTestId } = screen();
    await findByText("Choose picture");
    expect(queryByTestId("rc-qr-box")).toBeNull();
    expect(queryByTestId("rc-qr-thumb")).toBeNull();
  });
});

describe("upload: product-picture helper first, then the unchanged QR encoding", () => {
  let canvases: { w: number; h: number; type: string }[] = [];
  let draws: number[][] = [];
  beforeEach(() => {
    canvases = []; draws = [];
    HTMLCanvasElement.prototype.getContext = function () { return { fillRect() {}, fillStyle: "" } as unknown as CanvasRenderingContext2D; } as never;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, type?: string) {
      canvases.push({ w: this.width, h: this.height, type: String(type) });
      return type === "image/png" ? "data:image/png;base64,AAAA" : "data:image/jpeg;base64,BBBB";
    });
  });
  const upright = (w: number, hgt: number) => ({ w, h: hgt, done: vi.fn(), draw: vi.fn((_c: unknown, cw: number, ch: number) => { draws.push([cw, ch]); }) });

  it("a sideways phone photo / HEIC goes through decodeUpright; its upright size → ≤ 600 px, PNG first, whole picture drawn", async () => {
    const pic = upright(3024, 4032); // upright portrait (the helper already turned it)
    h.decode.mockResolvedValue(pic);
    const file = new File(["heic"], "IMG_0001.HEIC", { type: "image/heic" });
    const url = await downscaleQrFile(file);
    expect(h.decode).toHaveBeenCalledWith(file, {});
    expect(url).toBe("data:image/png;base64,AAAA");
    expect(canvases[0]).toEqual({ w: 450, h: QR_MAX_SIDE, type: "image/png" }); // 3024×4032 → 450×600, shape kept
    expect(draws[0]).toEqual([450, 600]); // the whole canvas = the whole picture (no crop)
    expect(pic.done).toHaveBeenCalledTimes(1);
  });
  it("PNG over the cap → JPEG next, same as before; nothing fits → null", async () => {
    h.decode.mockResolvedValue(upright(600, 600));
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, type?: string) {
      canvases.push({ w: this.width, h: this.height, type: String(type) });
      return type === "image/png" ? "data:image/png;base64," + "A".repeat(QR_DATA_URL_CAP) : "data:image/jpeg;base64,BBBB";
    });
    expect(await downscaleQrFile(new Blob(["x"]))).toBe("data:image/jpeg;base64,BBBB");
    expect(canvases.map((c) => c.type).slice(0, 2)).toEqual(["image/png", "image/jpeg"]);
  });
  it("an unreadable file still throws (the screen shows its 'couldn't use this picture' note)", async () => {
    h.decode.mockResolvedValue(null);
    await expect(downscaleQrFile(new Blob(["?"]))).rejects.toThrow("decode_failed");
  });
  it("source: downscaleQrFile uses decodeUpright and keeps 600 / the cap / PNG-first", () => {
    const src = readFileSync("src/redesign/adapters/receiptSettings.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function downscaleQrFile"));
    expect(fn).toContain("await decodeUpright(file, opts)");
    expect(fn).toContain("fitWithin(up.w, up.h)"); // default maxSide = QR_MAX_SIDE
    expect(fn).toContain("encodeUnderCap(");
    expect(fn).not.toContain("new Image()"); // the old decode-only path is gone
    expect(src).toContain("export const QR_MAX_SIDE = 600;");
    expect(src).toContain("export const QR_DATA_URL_CAP = 300_000;");
  });
});
