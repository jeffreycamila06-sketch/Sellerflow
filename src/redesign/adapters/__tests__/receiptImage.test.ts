// Messenger receipt picture — the PURE layout (no canvas): total rule, zero-price lines,
// wrapping that never clips, order of blocks, with and without the seller's QR.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  layoutReceipt, receiptTotalText, wrapText, formatAmount,
  RECEIPT_WIDTH, RECEIPT_PAD, QR_MAX_WIDTH, type ReceiptInput, type DrawOp, type Measure,
} from "../receiptImage";

// Fake measurement: every character is 0.55 × the font size wide.
const measure: Measure = (t, font) => Array.from(t).length * Number(/(\d+)px/.exec(font)![1]) * 0.55;
const labels = { total: "Total", toBeConfirmed: "to be confirmed" };
const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  opening: "Thank you for joining!", buyerName: "Maria Santos", buyerNum: 7, currency: "NT$", note: "Pay within 3 days.",
  lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }], labels, ...over,
});
const texts = (ops: DrawOp[]) => ops.filter((o): o is Extract<DrawOp, { kind: "text" }> => o.kind === "text");
const CW = RECEIPT_WIDTH - RECEIPT_PAD * 2;

describe("total rule", () => {
  it("sum only when EVERY line has total > 0", () => {
    expect(receiptTotalText([{ item: "a", total: 350 }, { item: "b", total: 280 }], "NT$", "tbc")).toEqual({ text: "NT$630", allPriced: true });
    expect(receiptTotalText([{ item: "a", total: 350 }, { item: "b", total: 0 }], "NT$", "tbc")).toEqual({ text: "tbc", allPriced: false });
    expect(receiptTotalText([], "NT$", "tbc")).toEqual({ text: "tbc", allPriced: false });
    expect(formatAmount("₱", 1234.5)).toBe("₱1,234.5");
  });
  it("the layout shows the sum, or 'to be confirmed' in place of the amount", () => {
    expect(layoutReceipt(base(), measure).totalText).toBe("NT$630");
    const l = layoutReceipt(base({ lines: [{ item: "100", total: 0 }, { item: "A1", total: 350 }] }), measure);
    expect(l.totalText).toBe("to be confirmed");
    expect(texts(l.ops).some((o) => o.text === "to be confirmed" && o.align === "right")).toBe(true);
  });
});

describe("line prices", () => {
  it("a priced line shows currency + amount right-aligned; a zero line shows the item with no price", () => {
    const l = layoutReceipt(base({ lines: [{ item: "100", total: 0 }, { item: "B2", total: 280 }] }), measure);
    const right = texts(l.ops).filter((o) => o.align === "right").map((o) => o.text);
    expect(right).toContain("NT$280");
    expect(right.some((t) => t.includes("NT$0"))).toBe(false);
    expect(texts(l.ops).some((o) => o.text === "100" && o.align === "left")).toBe(true);
  });
});

describe("wrapping never clips", () => {
  it("long words, spaces and CJK all wrap within the width; newlines are kept", () => {
    for (const s of ["word ".repeat(80), "x".repeat(300), "北部還有嗎".repeat(40), "Мерси ".repeat(50)]) {
      const lines = wrapText(s.trim(), 300, "400 24px x", measure);
      expect(lines.length).toBeGreaterThan(1);
      for (const ln of lines) expect(measure(ln, "400 24px x")).toBeLessThanOrEqual(300);
      expect(lines.join("").replace(/\s/g, "")).toBe(s.replace(/\s/g, ""));
    }
    expect(wrapText("a\n\nb", 300, "400 24px x", measure)).toEqual(["a", "", "b"]);
  });
  it("every text op fits inside the picture and the content width", () => {
    const l = layoutReceipt(base({
      opening: "Salamat po sa pagsali! ".repeat(8),
      note: "Bayad via GCash o bank transfer within 3 days, then send a screenshot. ".repeat(6),
      lines: [{ item: "Very long item description that keeps going ".repeat(4), total: 1299 }, { item: "北部還有嗎".repeat(20), total: 0 }],
    }), measure);
    for (const o of texts(l.ops)) {
      expect(o.y).toBeLessThanOrEqual(l.height);
      const w = measure(o.text, o.font);
      const left = o.align === "right" ? o.x - w : o.x;
      expect(left).toBeGreaterThanOrEqual(RECEIPT_PAD - 0.01);
      expect(left + w).toBeLessThanOrEqual(RECEIPT_PAD + CW + 0.01);
    }
  });
});

describe("block order and QR", () => {
  it("opening → #N name → lines → total → note → QR, centred, max 420 wide, aspect kept", () => {
    const l = layoutReceipt(base(), measure, { w: 600, h: 900 });
    const yOf = (t: string) => texts(l.ops).find((o) => o.text === t)!.y;
    expect(yOf("Thank you for joining!")).toBeLessThan(yOf("#7 Maria Santos"));
    expect(yOf("#7 Maria Santos")).toBeLessThan(yOf("A1"));
    expect(yOf("A1")).toBeLessThan(yOf("Total"));
    expect(yOf("Total")).toBeLessThan(yOf("Pay within 3 days."));
    const img = l.ops.find((o) => o.kind === "image") as Extract<DrawOp, { kind: "image" }>;
    expect(img.w).toBe(QR_MAX_WIDTH);
    expect(img.h).toBe(630);
    expect(img.x).toBe((RECEIPT_WIDTH - QR_MAX_WIDTH) / 2);
    expect(img.y).toBeGreaterThan(yOf("Pay within 3 days."));
    expect(l.height).toBeGreaterThanOrEqual(img.y + img.h);
  });
  it("no QR → no image op and a shorter picture; a small QR is never upscaled", () => {
    const without = layoutReceipt(base(), measure);
    expect(without.ops.some((o) => o.kind === "image")).toBe(false);
    expect(without.height).toBeLessThan(layoutReceipt(base(), measure, { w: 600, h: 600 }).height);
    const small = layoutReceipt(base(), measure, { w: 200, h: 200 }).ops.find((o) => o.kind === "image") as Extract<DrawOp, { kind: "image" }>;
    expect(small.w).toBe(200);
  });
  it("empty opening / note are skipped", () => {
    const l = layoutReceipt(base({ opening: "  ", note: "" }), measure);
    expect(texts(l.ops)[0].text).toBe("#7 Maria Santos");
  });
});

describe("independent of sticker / print code", () => {
  it("receiptImage imports nothing from the sticker or print modules", () => {
    const src = readFileSync("src/redesign/adapters/receiptImage.ts", "utf8");
    // its only import is the shared, import-free layout module
    expect(src.match(/^import .*$/gm)).toEqual(['import { layoutReceipt, RECEIPT_PAD, RECEIPT_RULE_COLOR, type Measure, type ReceiptInput } from "../../lib/receiptLayout.js";']);
    expect(readFileSync("src/lib/receiptLayout.js", "utf8")).not.toMatch(/^\s*import /m);
    expect(src).not.toMatch(/stickerRaster|stickerPreview|printerBridge|PrintPattern|\/Print"/);
  });
});
