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
  it("equal the app's rd_rc_pic_total / rd_rc_pic_tbc in every language", () => {
    const src = readFileSync(new URL("../../i18n/index.tsx", import.meta.url), "utf8");
    const parse = (key: string) => {
      const line = src.split("\n").find((l) => l.trimStart().startsWith(`${key}:`))!;
      return Object.fromEntries([...line.matchAll(/(?:"([\w-]+)"|(\w+)): "([^"]*)"/g)].map((m) => [m[1] || m[2], m[3]]));
    };
    const total = parse("rd_rc_pic_total"), tbc = parse("rd_rc_pic_tbc");
    expect(Object.keys(RECEIPT_LABELS).sort()).toEqual(Object.keys(total).sort());
    for (const lang of Object.keys(total)) expect(RECEIPT_LABELS[lang as keyof typeof RECEIPT_LABELS]).toEqual({ total: total[lang], toBeConfirmed: tbc[lang] });
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
