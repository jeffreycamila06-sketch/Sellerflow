// Messenger receipt — CARD format + Shipping fee (pure layout). Sizes unchanged (720 / 36 / fonts /
// QR caps / 400 lines / 12000 px); a rounded card wraps "#N name" → lines → shipping → total, the
// note and QR stay below it with small muted labels.
import { describe, it, expect } from "vitest";
import {
  layoutReceipt, RECEIPT_WIDTH, RECEIPT_PAD, type ReceiptInput, type DrawOp, type Measure,
} from "../receiptImage";
import { CARD_INSET, CARD_RADIUS, CARD_FILL, SHIP_TINT, RECEIPT_RULE_COLOR, RECEIPT_MAX_HEIGHT, RECEIPT_MAX_LINES } from "../../../lib/receiptLayout.js";

const measure: Measure = (t, font) => Array.from(t).length * Number(/(\d+)px/.exec(font)![1]) * 0.55;
const LABELS = { total: "Total", toBeConfirmed: "to be confirmed", shipping: "Shipping fee", howToPay: "How to pay", scanToPay: "Scan to pay" };
const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  opening: "Thank you for joining!", buyerName: "Maria Santos", buyerNum: 7, currency: "NT$", note: "Pay within 3 days.",
  lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }], labels: LABELS, ...over,
});
type Text = Extract<DrawOp, { kind: "text" }>;
type Box = Extract<DrawOp, { kind: "box" }>;
const texts = (ops: DrawOp[]) => ops.filter((o): o is Text => o.kind === "text");
const boxes = (ops: DrawOp[]) => ops.filter((o): o is Box => o.kind === "box");
const find = (ops: DrawOp[], t: string) => texts(ops).find((o) => o.text === t);
const CW = RECEIPT_WIDTH - RECEIPT_PAD * 2;

describe("shipping fee", () => {
  it("adds a tinted row after the lines (label left, amount right) and to the total", () => {
    const l = layoutReceipt(base({ shippingFee: 38 }), measure);
    expect(l.totalText).toBe("NT$668");
    const label = find(l.ops, "Shipping fee")!, amount = find(l.ops, "NT$38")!;
    expect(label.align).toBe("left");
    expect(amount.align).toBe("right");
    expect(label.y).toBe(amount.y);
    expect(label.y).toBeGreaterThan(find(l.ops, "B2")!.y);
    expect(label.y).toBeLessThan(find(l.ops, "Total")!.y);
    const tint = boxes(l.ops).find((b) => b.fill === SHIP_TINT)!;
    expect(tint).toBeTruthy();
    expect(tint.r).toBe(10);
    expect(tint.y).toBeLessThan(label.y);
    expect(tint.y + tint.h).toBeGreaterThan(label.y);
  });
  it("lines not all priced → 'to be confirmed', and the shipping row still shows", () => {
    const l = layoutReceipt(base({ shippingFee: 38, lines: [{ item: "A1", total: 350 }, { item: "100", total: 0 }] }), measure);
    expect(l.totalText).toBe("to be confirmed");
    expect(find(l.ops, "Shipping fee")).toBeTruthy();
    expect(find(l.ops, "NT$38")).toBeTruthy();
  });
  it("no fee (0 / missing) → no row, no tint, total = the lines", () => {
    for (const over of [{}, { shippingFee: 0 }]) {
      const l = layoutReceipt(base(over), measure);
      expect(l.totalText).toBe("NT$630");
      expect(find(l.ops, "Shipping fee")).toBeUndefined();
      expect(boxes(l.ops).some((b) => b.fill === SHIP_TINT)).toBe(false);
    }
  });
  it("a fee without its label (e.g. an old caller) → the old behaviour: no row, not added", () => {
    const l = layoutReceipt(base({ shippingFee: 38, labels: { total: "Total", toBeConfirmed: "to be confirmed" } }), measure);
    expect(l.totalText).toBe("NT$630");
    expect(texts(l.ops).some((o) => o.text === "NT$38")).toBe(false);
  });
});

describe("the card", () => {
  it("a rounded box (r 22, #fbfbfd, rule-colour stroke) drawn first, wrapping #N name → lines → total; opening above it", () => {
    const l = layoutReceipt(base({ shippingFee: 38 }), measure);
    const card = boxes(l.ops)[0];
    expect(l.ops.findIndex((o) => o === card)).toBeLessThan(l.ops.findIndex((o) => o.kind === "text" && o.text === "#7 Maria Santos"));
    expect(card).toMatchObject({ x: RECEIPT_PAD, w: CW, r: CARD_RADIUS, fill: CARD_FILL, stroke: RECEIPT_RULE_COLOR });
    const top = card.y, bottom = card.y + card.h;
    expect(find(l.ops, "Thank you for joining!")!.y).toBeLessThan(top);
    for (const t of ["#7 Maria Santos", "A1", "B2", "Shipping fee", "Total", "NT$668"]) {
      const y = find(l.ops, t)!.y;
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(bottom);
    }
    expect(find(l.ops, "Pay within 3 days.")!.y).toBeGreaterThan(bottom);
  });
  it("contents and rules are inset 22px inside the card", () => {
    const l = layoutReceipt(base(), measure);
    const IX = RECEIPT_PAD + CARD_INSET, IR = RECEIPT_PAD + CW - CARD_INSET;
    expect(find(l.ops, "#7 Maria Santos")!.x).toBe(IX);
    expect(find(l.ops, "Total")!.x).toBe(IX);
    expect(find(l.ops, "NT$350")!.x).toBe(IR);
    const rules = l.ops.filter((o): o is Extract<DrawOp, { kind: "rule" }> => o.kind === "rule");
    expect(rules).toHaveLength(2);
    for (const r of rules) { expect(r.x0).toBe(IX); expect(r.x1).toBe(IR); }
  });
});

describe("HOW TO PAY / Scan to pay", () => {
  it("note → a small muted uppercase letter-spaced HOW TO PAY above it; no note → none", () => {
    const l = layoutReceipt(base(), measure);
    const lab = find(l.ops, "HOW TO PAY")!;
    expect(lab.font).toMatch(/22px/);
    expect(lab.color).toBe("#6b6a7a");
    expect(lab.letterSpacing).toBeGreaterThan(0);
    expect(lab.y).toBeLessThan(find(l.ops, "Pay within 3 days.")!.y);
    expect(find(layoutReceipt(base({ note: "  " }), measure).ops, "HOW TO PAY")).toBeUndefined();
  });
  it("QR → a muted centred 'Scan to pay' under it; no QR → none", () => {
    const l = layoutReceipt(base(), measure, { w: 600, h: 600 });
    const img = l.ops.find((o) => o.kind === "image") as Extract<DrawOp, { kind: "image" }>;
    const scan = find(l.ops, "Scan to pay")!;
    expect(scan.align).toBe("center");
    expect(scan.x).toBe(RECEIPT_WIDTH / 2);
    expect(scan.y).toBeGreaterThan(img.y + img.h);
    expect(l.height).toBeGreaterThanOrEqual(scan.y);
    expect(find(layoutReceipt(base(), measure).ops, "Scan to pay")).toBeUndefined();
  });
});

describe("caps still hold", () => {
  it(`at most ${RECEIPT_MAX_LINES} lines; the rest become "…and N more"`, () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({ item: `x${i}`, total: 1 }));
    const l = layoutReceipt(base({ lines, shippingFee: 38, labels: { ...LABELS, more: "…and {n} more" } }), measure);
    expect(l.hiddenLines).toBeGreaterThanOrEqual(100);
    expect(l.height).toBeLessThanOrEqual(RECEIPT_MAX_HEIGHT);
  });
  it(`never taller than ${RECEIPT_MAX_HEIGHT}px — the total, shipping, note and the whole QR always fit`, () => {
    const lines = Array.from({ length: 400 }, (_, i) => ({ item: `Long item description number ${i} `.repeat(4), total: 99 }));
    const l = layoutReceipt(base({ lines, shippingFee: 38, note: "Pay via bank. ".repeat(30), labels: { ...LABELS, more: "…and {n} more" } }), measure, { w: 600, h: 1400 });
    expect(l.height).toBeLessThanOrEqual(RECEIPT_MAX_HEIGHT);
    const img = l.ops.find((o) => o.kind === "image") as Extract<DrawOp, { kind: "image" }>;
    expect(img.y + img.h).toBeLessThanOrEqual(l.height);
    expect(find(l.ops, "Scan to pay")!.y).toBeLessThanOrEqual(l.height);
    expect(find(l.ops, "Shipping fee")).toBeTruthy();
    expect(find(l.ops, "Total")).toBeTruthy();
    const card = boxes(l.ops)[0];
    expect(card.y + card.h).toBeLessThan(img.y);
  });
});
