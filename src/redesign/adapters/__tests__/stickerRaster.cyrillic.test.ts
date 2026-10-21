// Cyrillic (Bulgarian) buyer names on the generic-printer / Niimbot image paths: the separate
// Cyrillic atlas (RasterAtlases.cyrillic, opt-in) paints them on the same cell geometry; the
// Latin atlas file itself is untouched (goldens pinned elsewhere) and a render WITHOUT that
// atlas — the D520BT stream — is main's behaviour exactly (handle fallback). A Thai name (no
// atlas) still falls back to the handle — never tofu.
import { describe, it, expect } from "vitest";
import { stickerDrawOps, renderStickerBitmap, type RasterPayload } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";

const payload = (name: string, handle = "buyer_bg"): RasterPayload => ({
  storeName: "Store", sessionDate: "10/21/2026", currency: "NT$",
  buyer: { num: 7, name, handle, totalSpent: 100, orders: [{ time: "10:00", item: "PRICE" }] },
  settings: { printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: false },
});
const inkRows = (buf: Uint8Array, rowBytes: number, y0: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let b = 0; b < rowBytes; b++) if (buf[y * rowBytes + b]) { n++; break; }
  return n;
};

describe("Cyrillic on the bitmap path", () => {
  it("the Cyrillic atlas covers Bulgarian / Russian letters in all three cells", () => {
    for (const f of ["2", "3", "4"]) {
      const g = CYRILLIC_ATLAS[f].glyphs;
      for (const ch of "ИванПетровБългарияЖуков") expect(g[ch.codePointAt(0)!], `${f}:${ch}`).toBeTruthy();
    }
    expect(LATIN_ATLAS["4"].glyphs[0x418]).toBeUndefined(); // the Latin atlas file is NOT touched
  });
  it("a Bulgarian name is drawn as the name (font 4), not the handle fallback", () => {
    const { ops } = stickerDrawOps(payload("Иван Петров"), 60, 40, "extended", null, true);
    const name = ops.find((o) => o.k === "txt" && o.font === "4" && o.s === "Иван Петров");
    expect(name).toBeTruthy();
    expect(ops.some((o) => o.k === "txt" && o.s === "buyer_bg" && o.font === "4")).toBe(false);
  });
  it("and it actually paints ink on the name rows", () => {
    const { ops } = stickerDrawOps(payload("Иван Петров"), 60, 40, "extended", null, true);
    const name = ops.find((o) => o.k === "txt" && o.s === "Иван Петров")!;
    const img = renderStickerBitmap(payload("Иван Петров"), 60, 40, { latin: LATIN_ATLAS, cyrillic: CYRILLIC_ATLAS });
    const rows = inkRows(img.buf, img.rowBytes, name.y, name.y + 32);
    expect(rows).toBeGreaterThan(10);
    // a name of only unsupported script (Thai) → the handle prints instead, no blank line
    const thai = stickerDrawOps(payload("สมชาย"), 60, 40, "extended", null, true).ops;
    expect(thai.some((o) => o.k === "txt" && o.s === "buyer_bg" && o.font === "4")).toBe(true);
  });
  it("WITHOUT the Cyrillic atlas (the D520BT stream): a Cyrillic name still falls back to the handle, as on main", () => {
    const { ops } = stickerDrawOps(payload("Иван Петров"), 60, 40, "extended"); // no `extra`
    expect(ops.some((o) => o.k === "txt" && o.s === "Иван Петров")).toBe(false);
    expect(ops.some((o) => o.k === "txt" && o.s === "buyer_bg" && o.font === "4")).toBe(true);
    const plain = renderStickerBitmap(payload("Иван Петров"), 60, 40, { latin: LATIN_ATLAS });
    const withAtlas = renderStickerBitmap(payload("Иван Петров"), 60, 40, { latin: LATIN_ATLAS, cyrillic: CYRILLIC_ATLAS });
    expect(Buffer.from(plain.buf).equals(Buffer.from(withAtlas.buf))).toBe(false); // the atlas input is the ONLY switch
  });
  it("legacy (TEXT-path) mode is unchanged: Cyrillic still transliterates away → handle fallback", () => {
    const { ops } = stickerDrawOps(payload("Иван Петров"), 60, 40, "legacy");
    expect(ops.some((o) => o.k === "txt" && o.s === "Иван Петров")).toBe(false);
  });
});
