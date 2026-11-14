// @vitest-environment node
// B1-a — the server draws the SAME receipt as the phone (shared layoutReceipt), with the
// bundled Noto fonts. Pins: phone/server layout parity (boxes + lines; only the font family
// differs), the label table equals the app's rd_rc_pic_* text, rows → input mirrors
// rebuildSessionFromRows + buyerReceipt, CJK/Thai/Cyrillic draw real glyphs (no blank
// boxes), and a 20-item receipt with a QR stays a PNG under 400 KB.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { layoutReceipt, FONT_STACK } from "../../../lib/receiptLayout.js";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { buyerReceipt } from "../useReadData";
import {
  receiptInputFromRows, serverLayout, drawReceiptPng, RECEIPT_LABELS, SERVER_FONT_STACK,
} from "../../../../server/receiptDraw.js";

const fakeMeasure = (t: string, font: string) => t.length * (Number(/(\d+)px/.exec(font)?.[1]) || 10) * 0.55;
const row = (id: number, o: Record<string, unknown>) => ({
  id, user_id: "u", session_date: "2026-10-08", buyer_number: 7, handle: "anna", customer_name: "", platform: "Facebook",
  product: "A", price: 100, created_at: `2026-10-08T0${id}:00:00Z`, ...o,
});
const ROWS = [
  row(1, { product: "Red dress", price: 350 }),
  row(2, { product: "  ", price: 99 }),
  row(3, { product: "Bag", price: 0, customer_name: "Anna Lee" }),
  row(4, { product: "合計測試 長長的商品名稱 ".repeat(3), price: 120, qty: 2 }),
];

describe("receiptInputFromRows (raw rows, same as the phone)", () => {
  it("name + lines mirror rebuildSessionFromRows + buyerReceipt + the ReceiptSheet filter", () => {
    const r = buyerReceipt(rebuildSessionFromRows(ROWS as never).buyers, 7)!;
    const phoneLines = r.lines.filter((l) => l.item.trim() !== "").map((l) => ({ item: l.item.trim(), total: l.total > 0 ? l.total : 0 }));
    const input = receiptInputFromRows([...ROWS].reverse(), { lang: "zh-TW", currency: "NT$" });
    expect(input.buyerName).toBe(r.name);
    expect(input.buyerNum).toBe(7);
    expect(input.lines).toEqual(phoneLines);
    expect(input.labels).toEqual(RECEIPT_LABELS["zh-TW"]);
  });
  it("unknown language → English; a non-data QR is dropped", () => {
    const input = receiptInputFromRows(ROWS, { lang: "xx", qrImage: "https://evil/x.png" });
    expect(input.labels).toEqual(RECEIPT_LABELS.en);
    expect(input.qrImage).toBeNull();
  });
});

describe("phone/server layout parity", () => {
  it("same ops and size; only the font family differs", () => {
    const input = receiptInputFromRows(ROWS, { opening: "Hi! Thank you 謝謝", note: "Pay within 24h\nGCash ok", lang: "en" });
    for (const qr of [null, { w: 600, h: 600 }]) {
      const phone = layoutReceipt(input, fakeMeasure, qr);
      const server = serverLayout(input, fakeMeasure, qr);
      expect(server.width).toBe(phone.width);
      expect(server.height).toBe(phone.height);
      const norm = (ops: unknown[], stack: string) => JSON.parse(JSON.stringify(ops).split(stack.replace(/"/g, '\\"')).join("STACK"));
      expect(norm(server.ops, SERVER_FONT_STACK)).toEqual(norm(phone.ops, FONT_STACK));
    }
  });
});

describe("labels", () => {
  it("equal the app's rd_rc_pic_total / rd_rc_pic_tbc / rd_rc_pic_more in every language", () => {
    const src = readFileSync(new URL("../../i18n/index.tsx", import.meta.url), "utf8");
    const parse = (key: string) => {
      const line = src.split("\n").find((l) => l.trimStart().startsWith(`${key}:`))!;
      return Object.fromEntries([...line.matchAll(/(?:"([\w-]+)"|(\w+)): "([^"]*)"/g)].map((m) => [m[1] || m[2], m[3]]));
    };
    const total = parse("rd_rc_pic_total"), tbc = parse("rd_rc_pic_tbc"), more = parse("rd_rc_pic_more");
    expect(Object.keys(RECEIPT_LABELS).sort()).toEqual(Object.keys(total).sort());
    for (const lang of Object.keys(total)) expect(RECEIPT_LABELS[lang as keyof typeof RECEIPT_LABELS]).toEqual({ total: total[lang], toBeConfirmed: tbc[lang], more: more[lang] });
  });
});

describe("drawReceiptPng", () => {
  it("CJK, Thai and Cyrillic draw real, different glyphs (no blank boxes)", async () => {
    await drawReceiptPng(ROWS, {}); // registers the fonts
    const { createCanvas } = await import("@napi-rs/canvas");
    const glyph = (ch: string) => {
      const c = createCanvas(64, 64); const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = "#000";
      ctx.font = `40px ${SERVER_FONT_STACK}`; ctx.fillText(ch, 8, 48);
      return Buffer.from(ctx.getImageData(0, 0, 64, 64).data);
    };
    const blank = glyph(" ");
    for (const [a, b] of [["合", "計"], ["确", "认"], ["ร", "ว"], ["О", "щ"], ["ổ", "ộ"]]) {
      const ga = glyph(a), gb = glyph(b);
      expect(ga.equals(blank)).toBe(false);
      expect(ga.equals(gb)).toBe(false);
    }
  });
  it("card format: the server draws the card box (fill + stroke) and the inset rules; no shipping fee → no shipping row", async () => {
    const input = receiptInputFromRows(ROWS, { opening: "", note: "" });
    expect(input).not.toHaveProperty("shippingFee");
    const layout = serverLayout(input, fakeMeasure, null);
    const card = layout.ops.find((o) => o.kind === "box") as { x: number; y: number; w: number; h: number };
    expect(card).toBeTruthy();
    expect(layout.ops.filter((o) => o.kind === "box")).toHaveLength(1);            // card only, no shipping tint
    const rules = layout.ops.filter((o) => o.kind === "rule") as { y: number; x0: number; x1: number }[];
    const png = await drawReceiptPng(ROWS, { opening: "", note: "" });
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(png);
    const c = createCanvas(img.width, img.height); const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    expect(px(card.x + 30, card.y + 10)).toEqual([0xfb, 0xfb, 0xfd]);           // inside the card: #fbfbfd
    expect(px(10, card.y + 10)).toEqual([255, 255, 255]);                         // outside: white
    expect(px(card.x + 1, card.y + Math.round(card.h / 2))).not.toEqual([255, 255, 255]); // the stroke
    const r = rules[0];
    expect(px(Math.round((r.x0 + r.x1) / 2), r.y)).toEqual([0xe2, 0xe1, 0xea]);  // rule colour, inside the card
    expect(px(r.x0 - 8, r.y)).toEqual([0xfb, 0xfb, 0xfd]);                         // rule stops at the inset
  });
  it("a 20-item receipt with a QR is a PNG under 400 KB", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const q = createCanvas(600, 600); const qc = q.getContext("2d");
    qc.fillStyle = "#fff"; qc.fillRect(0, 0, 600, 600); qc.fillStyle = "#000";
    let seed = 7;
    for (let y = 0; y < 600; y += 20) for (let x = 0; x < 600; x += 20) { seed = (seed * 1103515245 + 12345) % 2147483648; if (seed % 2) qc.fillRect(x, y, 20, 20); }
    const qrImage = q.toDataURL("image/png");
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, { product: `商品 ${i} รายการ Платье long item name`, price: 100 + i }));
    const png = await drawReceiptPng(rows, { opening: "謝謝光臨！", note: "請於24小時內付款", qrImage, lang: "zh-TW" });
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeLessThan(400 * 1024);
  });
});
