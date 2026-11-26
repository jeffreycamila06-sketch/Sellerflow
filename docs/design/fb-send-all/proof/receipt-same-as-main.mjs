// P10 proof for FB-2. (1) The AFTER-LIVE automatic receipt picture is byte-for-byte main's: main's
// server/receiptDraw.js (git show origin/main) and the branch's draw the SAME inputs → the same PNG bytes,
// for several buyers (1 line, 3 lines, CJK / Thai / Cyrillic names, a price-0 line, a long item, a QR).
// (2) The Send all picture (labels + Invoicing shipping fee) in all 8 app languages → pictures/.
// Run from the repo root: node docs/design/fb-send-all/proof/receipt-same-as-main.mjs
import { execSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const tmp = join("server", ".receiptDraw.main.tmp.js");
writeFileSync(tmp, execSync("git show origin/main:server/receiptDraw.js", { encoding: "utf8" }));
const out = [];
try {
  const main = await import(join(process.cwd(), tmp));
  const branch = await import(join(process.cwd(), "server/receiptDraw.js"));
  const { SEND_ALL_LABELS } = await import(join(process.cwd(), "server/fbSendAll.js"));
  const QR = "data:image/png;base64," + execSync("node -e \"const {createCanvas}=require('@napi-rs/canvas');const c=createCanvas(200,200);const x=c.getContext('2d');x.fillStyle='#000';for(let i=0;i<20;i++)for(let j=0;j<20;j++)if((i*7+j*3)%5<2)x.fillRect(i*10,j*10,10,10);process.stdout.write(c.toBuffer('image/png').toString('base64'))\"", { encoding: "utf8" });
  const row = (n, name, product, price, qty = 1, k = 0) => ({ id: n * 10 + k, buyer_number: n, handle: name, customer_name: name, product, price, qty, created_at: new Date(Date.UTC(2026, 10, 26, 5, n, k)).toISOString() });
  const CASES = [
    ["one line, en", [row(1, "Maria Santos", "A1 dress", 350)], { lang: "en", currency: "NT$" }],
    ["three lines + note, fil", [row(2, "Joy Reyes", "B2 top", 280), row(2, "Joy Reyes", "C3 bag", 120, 2, 1), row(2, "Joy Reyes", "D4 cap", 90, 1, 2)], { lang: "fil", currency: "₱", note: "GCash 0917 000 0000" }],
    ["zh-TW name + opening", [row(3, "陳小美", "洋裝 A1", 590)], { lang: "zh-TW", currency: "NT$", opening: "謝謝購買！" }],
    ["th name", [row(4, "สมหญิง", "เสื้อ", 199)], { lang: "th", currency: "฿" }],
    ["bg name, price 0 (to be confirmed)", [row(5, "Иванка", "рокля", 0), row(5, "Иванка", "шал", 25, 1, 1)], { lang: "bg", currency: "лв" }],
    ["long item + QR", [row(6, "Kim Dela Cruz", "A very long item name that keeps going and going so it has to wrap onto the next line", 420)], { lang: "en", currency: "NT$", qrImage: QR }],
  ];
  out.push("(1) AFTER-LIVE automatic receipt: main vs branch, the same inputs (no labels, no shipping fee — what fbAutoReceipt passes)");
  for (const [name, rows, settings] of CASES) {
    const a = await main.drawReceiptPng(rows, settings), b = await branch.drawReceiptPng(rows, settings);
    const same = Buffer.compare(a, b) === 0;
    out.push(`  ${same ? "SAME" : "DIFFERENT"}  ${name}  (${a.length} bytes, sha256 ${createHash("sha256").update(a).digest("hex").slice(0, 16)})`);
    if (!same) process.exitCode = 1;
  }
  out.push("", "(2) Send all picture (the app's words + shipping fee 38) — pictures/sendall_<lang>.png");
  mkdirSync("docs/design/fb-send-all/pictures", { recursive: true });
  const NAMES = { en: "Lea Santos", fil: "Lea Santos", zh: "陈小美", "zh-TW": "陳小美", vi: "Nguyễn Thị Lan", th: "สมหญิง", id: "Siti Rahma", bg: "Иванка" };
  for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
    const rows = [row(9, NAMES[lang], "C3 bag", 120), row(9, NAMES[lang], "D4 cap", 90, 1, 1)];
    const png = await branch.drawReceiptPng(rows, { note: "Pay by bank transfer within 24 hours.\nBank 012 · 0000-1234-5678", shippingFee: 38, lang, currency: "NT$", labels: SEND_ALL_LABELS[lang], qrImage: QR });
    writeFileSync(`docs/design/fb-send-all/pictures/sendall_${lang}.png`, png);
    out.push(`  ${lang}: ${png.length} bytes`);
  }
} finally {
  rmSync(tmp, { force: true });
}
console.log(out.join("\n"));
writeFileSync("docs/design/fb-send-all/proof/receipt-same-as-main.txt", out.join("\n") + "\n");
