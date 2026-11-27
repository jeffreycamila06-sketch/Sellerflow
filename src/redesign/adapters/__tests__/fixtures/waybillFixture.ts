// FAKE TikTok Shop / J&T waybills + a fake Order list CSV, in the same shape as the real files
// (fictional names, numbers and addresses — no real buyer data in the repo).
//
// The PDF: A6 pages (297.64 × 419.53 pt), one waybill per page, laid out like the approved picture
// (docs/design/waybill-username): header row, barcode, sort code, Receiver / Sender / Signature boxes,
// the bottom block ("Weight:", "Payment :", "TT Order ID:", "RTS Time:", "EDT Time:") with the big grey
// "COD" watermark, and the right-hand column ("003", a QR, a vertical barcode).
// Text is REAL text: by default a composite font (Type0 / Identity-H, 2-byte codes = the glyph ids of
// Noto Sans) with a ToUnicode map — so the reader has to use ToUnicode, like on the real labels.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFName, PDFString, PDFArray, PDFNumber, type PDFRef } from "pdf-lib";
import opentype from "opentype.js";
type OtFont = { charToGlyph(c: string): { index: number; advanceWidth?: number } };

export const A6: [number, number] = [297.64, 419.53];
const FONT_PATH = resolve(__dirname, "../../../../../server/fonts/NotoSans.ttf");

export interface FixturePage {
  orderId?: string;          // 18 digits; omit to leave "TT Order ID" empty
  tracking?: string;         // JT…
  weight?: string;           // value after "Weight:"
  payment?: string;          // value after "Payment :"
  labels?: boolean;          // false → no Weight / Payment lines (a page the stamp must skip)
  lineAcrossBand?: boolean;  // a box line drawn through the free space (no room → not stamped)
  splitLabels?: boolean;     // "Weight:" drawn letter by letter with kerning (TJ)
  receiver?: string;
  realLabel?: boolean;       // like a REAL TikTok/J&T label (measured Nov 27 2026): the frame + logos are ONE
                             // full-page picture under everything, and "COD" is three separate huge DARK letters
}
export interface FixtureOptions {
  font?: "cid" | "std";      // cid = Type0 + ToUnicode (default); std = Helvetica, no ToUnicode, no Widths
  embed?: boolean;           // embed the font file (for pictures); tests do not need it
  leaveCtm?: boolean;        // the page content ends with an unclosed "q … cm" (bad PDFs do that)
}

// ── layout (pt, origin bottom-left) ─────────────────────────────────────────────────────────────
export const L = {
  x0: 13, x1: 285, y0: 10, y1: 400,
  colX: 223,                 // left line of the right-hand barcode column
  blockTop: 133,             // top line of the bottom block
  size: 7.4,                 // label font size
  lineGap: 11.5,             // baseline to baseline in the bottom block
  weightY: 120,
} as const;

interface Run { x: number; y: number; size: number; text: string; grey?: number; tj?: boolean }

function pageRuns(p: FixturePage): { runs: Run[]; draw: string[] } {
  const runs: Run[] = [];
  const draw: string[] = [];
  const t = (x: number, y: number, size: number, text: string, grey?: number) => runs.push({ x, y, size, text, grey });
  const line = (x1: number, y1: number, x2: number, y2: number, w = 1.1) => draw.push(`${w} w 0 G ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x: number, y: number, w: number, h: number, lw = 1.1) => draw.push(`${lw} w 0 G ${x} ${y} ${w} ${h} re S`);
  const bar = (x: number, y: number, w: number, h: number) => draw.push(`0 g ${x} ${y} ${w} ${h} re f`);
  const tr = p.tracking ?? "";
  // tracking numbers on top
  t(40, 405, 6, tr); t(126, 405, 6, tr); t(212, 405, 6, tr);
  // the outer box + rows
  rect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0, 1.2);
  line(L.x0, 375, L.x1, 375); line(L.x0, 358, L.x1, 358); line(L.x0, 315, L.x1, 315); line(L.x0, 293, L.x1, 293);
  line(115, 375, 115, 400); line(205, 375, 205, 400);
  t(32, 384, 10, "TikTok Shop"); t(130, 384, 10, "J&T Express"); t(238, 382, 13, "EZ");
  t(95, 363, 10, "On Time Delivery Promised");
  for (let k = 0; k < 44; k++) bar(52 + k * 4.3, 330, k % 3 === 0 ? 2.2 : 1.2, 24);
  t(105, 319, 10, tr);
  t(95, 298, 22, "000-A000 00");
  // left column boxes
  line(L.colX, L.y0, L.colX, 293);
  line(L.x0, 231, L.colX, 231); line(L.x0, 185, L.colX, 185); line(L.x0, L.blockTop, L.colX, L.blockTop);
  t(17, 282, 7, `Receiver:  ${p.receiver ?? "A**a S***s"}     (+63)99******21`);
  t(17, 270, 8, "BATAAN, BALANGA-CITY, SAMPLE BARANGAY,");
  t(17, 260, 8, "Sample Street 12");
  t(17, 220, 7, "Sender:  Sample Shop");
  t(17, 208, 8, "PAMPANGA, SAN-FERNANDO, SAMPLE");
  t(17, 174, 7, "Signature:");
  t(150, 158, 7, "Delivery Attempts");
  rect(165, L.blockTop, 19, 19); rect(184, L.blockTop, 19, 19); rect(203, L.blockTop, 20, 19);
  t(172, 138, 11, "1"); t(191, 138, 11, "2"); t(210, 138, 11, "3");
  // the bottom block
  if (p.realLabel) { t(58.9, 35.8 + 40, 53.6, "C", 0); t(98, 35.8 + 40, 53.6, "O", 0); t(140, 35.8 + 40, 53.6, "D", 0); }
  else t(98, 92, 32, "COD", 0.83); // the grey watermark (drawn first, under the text)
  const ys = [0, 1, 2, 3, 4].map((k) => L.weightY - k * L.lineGap);
  if (p.labels !== false) {
    if (p.splitLabels) runs.push({ x: 17, y: ys[0], size: L.size, text: "Weight:", tj: true });
    else t(17, ys[0], L.size, "Weight:");
    t(50, ys[0], L.size, p.weight ?? "0.500 KG");
    t(17, ys[1], L.size, "Payment :");
    t(54, ys[1], L.size, p.payment ?? "PP_PM");
  }
  t(17, ys[2], L.size, "TT Order ID:");
  if (p.orderId) t(64, ys[2], L.size, p.orderId);
  t(17, ys[3], L.size, "RTS Time:");
  t(56, ys[3], L.size, "2026-11-28");
  t(17, ys[4], L.size, "EDT Time:");
  rect(152, L.y0, 71, 16);
  if (p.lineAcrossBand) line(L.x0, ys[0] - 4, L.colX, ys[0] - 4, 0.8);
  // the right-hand column
  t(240, 270, 16, "003");
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if ((r * 7 + c * 3) % 4 < 2 || r % 8 === 0 || c % 8 === 0) bar(231 + c * 5, 205 + r * 5, 5, 5);
  for (let k = 0; k < 36; k++) bar(236, 18 + k * 5, 34, k % 2 ? 1.4 : 2.6);
  return { runs, draw };
}

// ── fonts ───────────────────────────────────────────────────────────────────────────────────────
let fontCache: { bytes: Uint8Array; font: OtFont } | null = null;
function noto() {
  if (fontCache) return fontCache;
  const bytes = new Uint8Array(readFileSync(FONT_PATH));
  fontCache = { bytes, font: opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as OtFont };
  return fontCache;
}
const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
const escPdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export async function buildWaybillPdf(pages: FixturePage[], opts: FixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const all = pages.map(pageRuns);
  let fontRef: PDFRef;
  let encode: (s: string) => string;
  let encodeTj: (s: string) => string;
  if ((opts.font ?? "cid") === "cid") {
    const { bytes, font } = noto();
    const gid = new Map<string, { id: number; w: number }>();
    for (const pg of all) for (const r of pg.runs) for (const ch of r.text) {
      if (!gid.has(ch)) { const g = font.charToGlyph(ch); gid.set(ch, { id: g.index, w: Math.round(g.advanceWidth ?? 600) }); }
    }
    const byId = new Map<number, { ch: string; w: number }>();
    for (const [ch, v] of gid) byId.set(v.id, { ch, w: v.w });
    const ids = [...byId.keys()].sort((a, b) => a - b);
    const cmap = [
      "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
      "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
      `${ids.length} beginbfchar`,
      ...ids.map((id) => `<${hex4(id)}> <${[...byId.get(id)!.ch].map((c) => hex4(c.charCodeAt(0))).join("")}>`),
      "endbfchar", "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
    ].join("\n");
    const tuRef = ctx.register(ctx.flateStream(cmap));
    const fdDict: Record<string, unknown> = {
      Type: "FontDescriptor", FontName: "NotoSans", Flags: 32, FontBBox: [-621, -389, 2800, 1067], ItalicAngle: 0,
      Ascent: 1069, Descent: -293, CapHeight: 714, StemV: 80,
    };
    if (opts.embed) fdDict.FontFile2 = ctx.register(ctx.flateStream(bytes, { Length1: bytes.length }));
    const fdRef = ctx.register(ctx.obj(fdDict as never));
    const w = PDFArray.withContext(ctx);
    for (const id of ids) { w.push(PDFNumber.of(id)); w.push(ctx.obj([byId.get(id)!.w])); }
    const cid = ctx.obj({
      Type: "Font", Subtype: "CIDFontType2", BaseFont: "NotoSans",
      CIDSystemInfo: ctx.obj({ Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 }),
      FontDescriptor: fdRef, DW: 1000, W: w, CIDToGIDMap: "Identity",
    });
    const cidRef = ctx.register(cid);
    fontRef = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type0", BaseFont: "NotoSans", Encoding: "Identity-H", DescendantFonts: [cidRef], ToUnicode: tuRef }));
    encode = (s) => `<${[...s].map((c) => hex4(gid.get(c)!.id)).join("")}> Tj`;
    encodeTj = (s) => `[${[...s].map((c) => `<${hex4(gid.get(c)!.id)}>`).join(" -12 ")}] TJ`;
  } else {
    fontRef = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" }));
    encode = (s) => `(${escPdf(s)}) Tj`;
    encodeTj = (s) => `[${[...s].map((c) => `(${escPdf(c)})`).join(" -12 ")}] TJ`;
  }
  const bgRef = ctx.register(ctx.stream(new Uint8Array([255]), { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 }));
  for (const [k, { runs, draw }] of all.entries()) {
    const page = doc.addPage(A6);
    const real = pages[k].realLabel === true;
    page.node.set(PDFName.of("Resources"), ctx.obj(real ? { Font: ctx.obj({ F1: fontRef }), XObject: ctx.obj({ Im1: bgRef }) } : { Font: ctx.obj({ F1: fontRef }) }));
    const body: string[] = [...(real ? ["q 274.8 0 0 414.8 12.3 2.8 cm /Im1 Do Q"] : []), "q", ...draw, "Q"];
    for (const r of runs) {
      body.push(`BT ${r.grey ?? 0} g /F1 ${r.size} Tf 1 0 0 1 ${r.x} ${r.y} Tm ${r.tj ? encodeTj(r.text) : encode(r.text)} ET`);
    }
    if (opts.leaveCtm) body.push("q 1 0 0 1 40 -30 cm 0.5 0 0 0.5 0 0 cm");
    const ref = ctx.register(ctx.flateStream(body.join("\n")));
    page.node.set(PDFName.of("Contents"), ref);
  }
  return doc.save();
}

// ── the CSV ─────────────────────────────────────────────────────────────────────────────────────
export interface FixtureOrder { orderId: string; tracking?: string; masked: string; items?: number }
export interface CsvOptions { bom?: boolean; crlf?: boolean; reorder?: boolean; noUsername?: boolean; descriptionRow?: boolean; tabPrefix?: boolean }

export function buildOrderCsv(orders: FixtureOrder[], opts: CsvOptions = {}): string {
  const cols = ["Order ID", "Order Status", "Product Name", "Variation", "Quantity", "Order Amount", "Tracking ID", "Shipping Provider Name", "Buyer Message", ...(opts.noUsername ? [] : ["Buyer Username"]), "Recipient", "Phone #", "Detail Address"];
  const header = opts.reorder ? [...cols].reverse() : cols;
  const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, "\"\"")}"` : v);
  const lines: string[] = [header.map(q).join(",")];
  if (opts.descriptionRow) lines.push(header.map((h) => q(`${h} (platform field)`)).join(","));
  for (const o of orders) {
    for (let k = 0; k < (o.items ?? 1); k++) {
      const row: Record<string, string> = {
        "Order ID": opts.tabPrefix ? `\t${o.orderId}` : o.orderId,
        "Order Status": "To ship",
        "Product Name": `Sample blouse, size ${k + 1}`,
        Variation: "Blue, M",
        Quantity: "1",
        "Order Amount": "PHP 150.00",
        "Tracking ID": o.tracking ?? "",
        "Shipping Provider Name": "J&T Express",
        "Buyer Message": "Please \"wrap\" it, thanks\nsecond line",
        "Buyer Username": o.masked,
        Recipient: "S***e B***r",
        "Phone #": "(+63)99******21",
        "Detail Address": "Sample Street 12, Sample Barangay",
      };
      lines.push(header.map((h) => q(row[h] ?? "")).join(","));
    }
  }
  const nl = opts.crlf ? "\r\n" : "\n";
  return (opts.bom ? "\uFEFF" : "") + lines.join(nl) + nl;
}
