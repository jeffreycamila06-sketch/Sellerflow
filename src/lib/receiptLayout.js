// MESSENGER RECEIPT LAYOUT — PURE and SHARED: the phone (src/redesign/adapters/receiptImage.ts,
// browser canvas) and the server (server/receiptDraw.js, @napi-rs/canvas, automatic receipt)
// lay the picture out with this ONE function, so the two pictures have the same boxes and
// lines; only the fonts differ (the phone uses its system fonts, the server bundled Noto).
// Text measurement is injected. Types: receiptLayout.d.ts. No imports, no DOM, no Node.

export const RECEIPT_WIDTH = 720;
export const RECEIPT_PAD = 36;
export const QR_MAX_WIDTH = 420;
export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", "Helvetica Neue", Arial, sans-serif';
export const RECEIPT_RULE_COLOR = "#e2e1ea";

// Sized for the Messenger bubble (~260 px wide on a phone, so the 720 px picture shows at ~0.36×):
// items 30 px and the total 36 px read at ~11–13 px there (Build 7; were 24 / 30).
export function receiptFonts(stack = FONT_STACK) {
  return {
    opening: `500 32px ${stack}`,
    header: `700 38px ${stack}`,
    num: `500 27px ${stack}`,
    item: `400 30px ${stack}`,
    price: `600 30px ${stack}`,
    totalLabel: `700 34px ${stack}`,
    totalAmount: `700 36px ${stack}`,
    note: `400 28px ${stack}`,
  };
}
const LH = { opening: 42, header: 48, item: 40, total: 48, note: 38 };
const NUM_COL = 54;   // "12." column
const GAP = 16;       // between item text and price
const INK = "#16151f", MUTED = "#6b6a7a";

export const formatAmount = (currency, n) =>
  `${currency}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Total rule: the sum only when there is at least one line and EVERY line has total > 0;
// otherwise the "to be confirmed" label stands in for the amount.
export function receiptTotalText(lines, currency, toBeConfirmed) {
  const allPriced = lines.length > 0 && lines.every((l) => Number(l.total) > 0);
  if (!allPriced) return { text: toBeConfirmed, allPriced };
  const sum = lines.reduce((s, l) => s + Number(l.total), 0);
  return { text: formatAmount(currency, sum), allPriced };
}

// Greedy wrap that never clips: break at the last space when there is one, otherwise
// mid-word (CJK has no spaces). Explicit newlines start a new line; empty lines are kept.
export function wrapText(text, maxWidth, font, measure) {
  const out = [];
  for (const para of String(text ?? "").split(/\r?\n/)) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line === "" || measure(next, font) <= maxWidth) { line = next; continue; }
      const sp = line.lastIndexOf(" ");
      if (sp > 0) {
        out.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        out.push(line);
        line = ch;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutReceipt(input, measure, qrSize, fontStack = FONT_STACK) {
  const F = receiptFonts(fontStack);
  const W = RECEIPT_WIDTH, P = RECEIPT_PAD, CW = W - P * 2;
  const ops = [];
  let y = P;
  const text = (t, x, font, align = "left", color = INK) =>
    ops.push({ kind: "text", text: t, x, y, font, align, color });

  if (input.opening.trim()) {
    for (const l of wrapText(input.opening.trim(), CW, F.opening, measure)) { y += LH.opening; text(l, P, F.opening); }
    y += 18;
  }
  const header = `#${input.buyerNum} ${input.buyerName}`.trim();
  for (const l of wrapText(header, CW, F.header, measure)) { y += LH.header; text(l, P, F.header); }
  y += 16; ops.push({ kind: "rule", y }); y += 8;

  input.lines.forEach((ln, i) => {
    const priced = Number(ln.total) > 0;
    const price = priced ? formatAmount(input.currency, Number(ln.total)) : "";
    const priceW = priced ? measure(price, F.price) : 0;
    const itemW = CW - NUM_COL - (priced ? priceW + GAP : 0);
    const wrapped = wrapText(ln.item || "", Math.max(itemW, 40), F.item, measure);
    wrapped.forEach((l, j) => {
      y += LH.item;
      if (j === 0) {
        text(`${i + 1}.`, P, F.num, "left", MUTED);
        if (priced) text(price, P + CW, F.price, "right");
      }
      text(l, P + NUM_COL, F.item);
    });
    y += 6;
  });

  y += 6; ops.push({ kind: "rule", y }); y += 6;
  const { text: totalText, allPriced } = receiptTotalText(input.lines, input.currency, input.labels.toBeConfirmed);
  const labelW = measure(input.labels.total, F.totalLabel);
  const amountFont = allPriced ? F.totalAmount : F.totalLabel;
  const amountLines = wrapText(totalText, Math.max(CW - labelW - GAP, 80), amountFont, measure);
  amountLines.forEach((l, j) => {
    y += LH.total;
    if (j === 0) text(input.labels.total, P, F.totalLabel);
    text(l, P + CW, amountFont, "right", allPriced ? INK : MUTED);
  });

  if (input.note.trim()) {
    y += 22;
    for (const l of wrapText(input.note.trim(), CW, F.note, measure)) { y += LH.note; text(l, P, F.note); }
  }
  if (qrSize && qrSize.w > 0 && qrSize.h > 0) {
    const w = Math.min(QR_MAX_WIDTH, CW, qrSize.w);
    const h = Math.round((qrSize.h * w) / qrSize.w);
    y += 24;
    ops.push({ kind: "image", x: Math.round((W - w) / 2), y, w, h });
    y += h;
  }
  return { width: W, height: Math.ceil(y + P), ops, totalText, allPriced };
}
