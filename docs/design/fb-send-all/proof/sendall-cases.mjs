// More Send all pictures (printer-guardian list): drawn through the SAME runner `picture()` path (preview),
// so emoji removal and the cancelled-line rule apply exactly as in the job. → pictures/case_<name>.png
// Run from the repo root: node docs/design/fb-send-all/proof/sendall-cases.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { createSendAllRunner } = await import(join(process.cwd(), "server/fbSendAll.js"));
const S = "11111111-2222-3333-4444-555555555555";
const row = (n, name, product, price, qty = 1, k = 0, id = n * 10 + k) => ({ id, session_id: S, buyer_number: n, handle: name, customer_name: name, product, price, qty, created_at: new Date(Date.UTC(2026, 10, 26, 5, n, k)).toISOString() });
const NOTE = "Pay by bank transfer within 24 hours.\nBank 012 · 0000-1234-5678";
const CASES = [
  ["emoji_name", [row(1, "Maria 🌸 Cruz", "🔥 A1 dress", 350)], { note: "GCash 📱 0917 000 0000", shippingFee: 38 }, []],
  ["kana_name", [row(2, "田中さん", "ワンピース", 1200)], { note: NOTE, shippingFee: 60 }, []],
  ["korean_name_known_box", [row(3, "김민지", "Dress", 300)], { note: NOTE, shippingFee: 0 }, []],
  ["price0_plus_shipping", [row(4, "Joy Reyes", "FREE", 0), row(4, "Joy Reyes", "B2 top", 280, 1, 1)], { note: NOTE, shippingFee: 38 }, []],
  ["no_note_no_qr_no_fee", [row(5, "Ben Lee", "C3 bag", 120)], { note: "", shippingFee: 0 }, []],
  ["long_item_wraps", [row(6, "Kim Dela Cruz", "A very long item name that keeps going and going so it has to wrap onto the next line of the receipt", 420)], { note: NOTE, shippingFee: 38 }, []],
  ["cancelled_line_left_out", [row(7, "Lea Santos", "C3 bag", 120), row(7, "Lea Santos", "D4 cap (cancelled)", 90, 1, 1)], { note: NOTE, shippingFee: 38 }, [71]],
  ["many_lines", Array.from({ length: 24 }, (_, k) => row(8, "Rica Mendoza", `Item ${k + 1}`, 50 + k, 1, k)), { note: NOTE, shippingFee: 38 }, []],
];
const out = [];
for (const [name, rows, settings, cancels] of CASES) {
  const runner = createSendAllRunner({
    enabled: async () => true, receipt: {}, config: {},
    store: {
      hasReceiptAccess: async () => true, isAdmin: async () => false,
      listSessionFbRows: async () => rows, listLineCancels: async () => cancels,
      getSendAllSettings: async () => ({ opening: "", qrImage: null, ...settings }),
    },
  });
  const r = await runner.preview("u", { sessionId: S, buyerNumber: rows[0].buyer_number, lang: "en", currency: "NT$" });
  if (!r.json.ok) { out.push(`${name}: FAILED ${r.json.error}`); continue; }
  writeFileSync(`docs/design/fb-send-all/pictures/case_${name}.png`, Buffer.from(r.json.png, "base64"));
  out.push(`${name}: ok`);
}
console.log(out.join("\n"));
