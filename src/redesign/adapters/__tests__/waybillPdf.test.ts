// WAYBILL USERNAME — the PDF: read the fake J&T waybills (same shape as TikTok's), write "@username",
// read the result back. Behaviour only: real PDF bytes in, real PDF bytes out.
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFArray, PDFRawStream, PDFRef, PDFName, decodePDFRawStream } from "pdf-lib";
import { scanWaybills, stampWaybills, placeOn, readWaybillPages, type PageInfo } from "../waybillPdf";
import { isIgnorable, STAMP_MAX_SIZE, STAMP_MIN_SIZE, textLines, type Box, type PageRead } from "../waybillPdfRead";
import { buildWaybillPdf, L, A6, type FixturePage } from "./fixtures/waybillFixture";

const P = (n: number, o: Partial<FixturePage> = {}): FixturePage => ({ orderId: `58000000000000${4820 + n}`, tracking: `JT000000000${4820 + n}`, ...o });
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (a: Box, b: Box) => a.x0 >= b.x0 - 0.01 && a.x1 <= b.x1 + 0.01 && a.y0 >= b.y0 - 0.01 && a.y1 <= b.y1 + 0.01;

async function scan(pdf: Uint8Array): Promise<PageInfo[]> {
  const r = await scanWaybills(pdf);
  if (!r.ok) throw new Error("error" in r ? r.error : "scan");
  return r.pages;
}
// every content stream of every page, decoded, in order (+ the page sizes)
async function streams(pdf: Uint8Array): Promise<{ boxes: number[][]; pages: string[][] }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages().map((pg) => {
    const c = pg.node.get(PDFName.of("Contents"));
    const list = c instanceof PDFRef && ctx.lookup(c) instanceof PDFArray ? (ctx.lookup(c) as PDFArray).asArray() : c instanceof PDFArray ? c.asArray() : [c];
    return list.map((r) => {
      const s = ctx.lookup(r as PDFRef);
      return new TextDecoder("latin1").decode(decodePDFRawStream(s as PDFRawStream).decode());
    });
  });
  return { boxes: doc.getPages().map((pg) => { const b = pg.getMediaBox(); return [b.x, b.y, b.width, b.height]; }), pages };
}
// the stamp as read back: the text piece that starts with "@"
const stampRun = (read: PageRead) => read.texts.find((t) => t.str.startsWith("@"));
const obstaclesOf = (read: PageRead, labelH: number) => [
  ...read.texts.filter((t) => !t.str.startsWith("@") && t.str.trim() && !isIgnorable(t, labelH)),
  ...read.marks.filter((m) => !isIgnorable(m, labelH)),
];

describe("reading the waybills", () => {
  it("each page: the 18-digit order id after 'TT Order ID', the tracking number, and the free space next to Weight / Payment", async () => {
    const pages = await scan(await buildWaybillPdf([P(1), P(2)]));
    expect(pages.map((p) => p.orderId)).toEqual(["580000000000004821", "580000000000004822"]);
    expect(pages[0].words).toContain("JT0000000004821");
    const s = pages[0].slot;
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.slot.x0).toBeGreaterThan(70);          // right of the Weight / Payment values
      expect(s.slot.x1).toBeLessThan(L.colX);         // left of the barcode column's line
      expect(s.slot.y1).toBeLessThanOrEqual(L.blockTop); // under the bottom block's top line
      expect(s.slot.y0).toBeGreaterThan(L.weightY - 2 * L.lineGap); // above the TT Order ID line
    }
  });
  it("the text is read through ToUnicode (composite font, codes ≠ letters) and through a plain font", async () => {
    for (const font of ["cid", "std"] as const) {
      const [p] = await scan(await buildWaybillPdf([P(1)], { font }));
      expect(p.orderId, font).toBe("580000000000004821");
      expect(p.slot.ok, font).toBe(true);
    }
    const reads = await readWaybillPages(await buildWaybillPdf([P(1)]));
    const lines = textLines(reads![0].read.texts).map((l) => l.text);
    expect(lines).toContain("Weight: 0.500 KG");
    expect(lines).toContain("Payment : PP_PM");
    expect(lines).toContain("TT Order ID: 580000000000004821");
  });
  it("'Weight:' drawn letter by letter with kerning is still found", async () => {
    const [p] = await scan(await buildWaybillPdf([P(1, { splitLabels: true })]));
    expect(p.slot.ok).toBe(true);
  });
  it("a page without the Weight / Payment lines → no place (no_labels)", async () => {
    const [p] = await scan(await buildWaybillPdf([P(1, { labels: false })]));
    expect(p.slot).toEqual({ ok: false, reason: "no_labels" });
  });
  it("a box line through the free space → no place (no_space)", async () => {
    const [p] = await scan(await buildWaybillPdf([P(1, { lineAcrossBand: true })]));
    expect(p.slot).toEqual({ ok: false, reason: "no_space" });
  });
  it("a file that is not a PDF → not_pdf (never a crash)", async () => {
    expect(await scanWaybills(new TextEncoder().encode("Order ID,Buyer Username\n1,a**b\n"))).toEqual({ ok: false, error: "not_pdf" });
    expect(await scanWaybills(new Uint8Array())).toEqual({ ok: false, error: "not_pdf" });
  });
});

describe("writing @username", () => {
  const PAGES = [P(1), P(2), P(3, { labels: false }), P(4), P(5)];
  it("N pages in = N pages out, same size, same order; every original drawing command byte for byte", async () => {
    const pdf = await buildWaybillPdf(PAGES);
    const pages = await scan(pdf);
    const out = await stampWaybills(pdf, pages, new Map([[0, "ana_ukay8"], [2, "mariel_3"], [3, "a_very_long_username_for_test.01"]]));
    const before = await streams(pdf);
    const after = await streams(out.bytes);
    expect(after.pages).toHaveLength(PAGES.length);
    expect(after.boxes).toEqual(before.boxes);
    expect(before.boxes[0]).toEqual([0, 0, ...A6]);
    expect(out.placed).toEqual([0, 3]); // page 2 has no labels → not stamped
    for (let i = 0; i < PAGES.length; i++) {
      const orig = before.pages[i];
      expect(orig).toHaveLength(1);
      if (out.placed.includes(i)) {
        // [q] [the original, unchanged] [Q] [the new drawing] — only ADDED on top
        expect(after.pages[i]).toHaveLength(4);
        expect(after.pages[i][0].trim()).toBe("q");
        expect(after.pages[i][1]).toBe(orig[0]);
        expect(after.pages[i][2].trim()).toBe("Q");
        expect(after.pages[i][3]).toMatch(/BT[\s\S]*Tf[\s\S]*Tj[\s\S]*ET/);
      } else {
        expect(after.pages[i], `page ${i} = the original page`).toEqual(orig); // skipped = untouched
      }
    }
    // the order of the pages is kept: page k still holds order k
    expect((await scan(out.bytes)).map((p) => p.orderId)).toEqual(PAGES.map((p) => p.orderId ?? null));
  });
  it("the stamp lands in the free space and touches NO existing text, line, barcode, QR or box (the grey COD may be under it)", async () => {
    const pdf = await buildWaybillPdf([P(1)]);
    const [info] = await scan(pdf);
    const before = (await readWaybillPages(pdf))![0].read;
    const out = await stampWaybills(pdf, [info], new Map([[0, "ana_ukay8"]]));
    const after = (await readWaybillPages(out.bytes))![0].read;
    const st = stampRun(after)!;
    expect(st.str).toBe("@ana_ukay8");
    if (!info.slot.ok) throw new Error("no slot");
    expect(inside(st, info.slot.slot)).toBe(true);
    const hits = obstaclesOf(before, info.slot.slot.labelH).filter((o) => overlap(o, st));
    expect(hits).toEqual([]);
    // right of BOTH values, on the Weight + Payment lines
    const lines = textLines(before.texts);
    const w = lines.find((l) => l.text.startsWith("Weight"))!, p = lines.find((l) => l.text.startsWith("Payment"))!;
    expect(st.x0).toBeGreaterThan(Math.max(...w.items.map((i) => i.x1), ...p.items.map((i) => i.x1)));
    expect(st.by).toBeGreaterThan(p.items[0].by - 0.3 * L.size);
    expect(st.by).toBeLessThan(w.items[0].by + 0.3 * L.size);
    // the COD watermark is the one thing under it (allowed)
    const cod = before.texts.find((t) => t.str === "COD")!;
    expect(overlap(cod, st)).toBe(true);
    expect(isIgnorable(cod, info.slot.slot.labelH)).toBe(true);
    // bold sans, black
    expect(st.h).toBeGreaterThanOrEqual(STAMP_MIN_SIZE);
    expect(st.h).toBeLessThanOrEqual(STAMP_MAX_SIZE);
  });
  it("a long username gets a smaller font so it stays on ONE line; a username too long for the smallest readable size is not stamped", async () => {
    const pdf = await buildWaybillPdf([P(1), P(2), P(3)]);
    const pages = await scan(pdf);
    const shortOne = placeOn(pages[0], "ana_ukay8")!;
    const longOne = placeOn(pages[1], "a_very_long_username_for_test.01")!;
    expect(longOne.size).toBeLessThan(shortOne.size);
    expect(longOne.size).toBeGreaterThanOrEqual(STAMP_MIN_SIZE);
    if (pages[1].slot.ok) expect(longOne.box.x1 - longOne.box.x0).toBeLessThanOrEqual(pages[1].slot.slot.x1 - pages[1].slot.slot.x0 + 0.01);
    const tooLong = "W".repeat(40);
    expect(placeOn(pages[2], tooLong)).toBeNull();
    const out = await stampWaybills(pdf, pages, new Map([[0, "ana_ukay8"], [1, "a_very_long_username_for_test.01"], [2, tooLong]]));
    expect(out.placed).toEqual([0, 1]);
    const after = await readWaybillPages(out.bytes);
    const st1 = stampRun(after![1].read)!;
    expect(st1.str).toBe("@a_very_long_username_for_test.01");
    expect(textLines(after![1].read.texts).filter((l) => l.text.includes("@"))).toHaveLength(1); // one line
    expect(stampRun(after![2].read)).toBeUndefined();
  });
  it("only TikTok-style usernames are stamped (the stamp font is plain Latin)", async () => {
    const [p] = await scan(await buildWaybillPdf([P(1)]));
    expect(placeOn(p, "ana.ukay_8")).not.toBeNull();
    expect(placeOn(p, "ana ukay")).toBeNull();
    expect(placeOn(p, "陳小美")).toBeNull();
    expect(placeOn(p, "")).toBeNull();
  });
  it("a page whose own drawing leaves a moved / scaled position behind: the stamp is at the same place", async () => {
    const plain = await buildWaybillPdf([P(1)]);
    const odd = await buildWaybillPdf([P(1)], { leaveCtm: true });
    const a = await stampWaybills(plain, await scan(plain), new Map([[0, "ana_ukay8"]]));
    const b = await stampWaybills(odd, await scan(odd), new Map([[0, "ana_ukay8"]]));
    const sa = stampRun((await readWaybillPages(a.bytes))![0].read)!;
    const sb = stampRun((await readWaybillPages(b.bytes))![0].read)!;
    for (const k of ["x0", "y0", "x1", "y1"] as const) expect(sb[k]).toBeCloseTo(sa[k], 3);
  });
  it("no stamps → every page exactly as it was", async () => {
    const pdf = await buildWaybillPdf([P(1), P(2)]);
    const out = await stampWaybills(pdf, await scan(pdf), new Map());
    expect(out.placed).toEqual([]);
    expect((await streams(out.bytes)).pages).toEqual((await streams(pdf)).pages);
  });
});
