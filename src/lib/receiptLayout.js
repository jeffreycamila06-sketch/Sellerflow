// MESSENGER RECEIPT LAYOUT — PURE and SHARED: the phone (src/redesign/adapters/receiptImage.ts,
// browser canvas) and the server (server/receiptDraw.js, @napi-rs/canvas, automatic receipt)
// lay the picture out with this ONE function, so the two pictures have the same boxes and
// lines; only the fonts differ (the phone uses its system fonts, the server bundled Noto).
// Text measurement is injected. Types: receiptLayout.d.ts. No imports, no DOM, no Node.

export const RECEIPT_WIDTH = 720;
export const RECEIPT_PAD = 36;
export const QR_MAX_WIDTH = 420;
// Build 8 caps (same on the phone and the server): at most RECEIPT_MAX_LINES order lines (the rest
// become one "…and N more" row), a picture at most RECEIPT_MAX_HEIGHT tall (lines stop early to keep
// the total, note and QR), and a QR at most QR_MAX_HEIGHT tall.
export const RECEIPT_MAX_LINES = 400;
export const RECEIPT_MAX_HEIGHT = 12000;
export const QR_MAX_HEIGHT = 1000;
export const MORE_LABEL_DEFAULT = "…and {n} more";
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
    label: `600 22px ${stack}`, // the small muted "HOW TO PAY" / "Scan to pay" labels (card format)
  };
}
const LH = { opening: 42, header: 48, item: 40, total: 48, note: 38, label: 30 };
// Card format: a rounded box around "#N name" → lines → shipping → total; its contents inset 22 px.
export const CARD_RADIUS = 22, CARD_INSET = 22, CARD_FILL = "#fbfbfd";
export const SHIP_TINT = "#fff7dc", SHIP_RADIUS = 10, SHIP_PAD = 12;
const NUM_COL = 54;   // "12." column
const GAP = 16;       // between item text and price
const INK = "#16151f", MUTED = "#6b6a7a";

export const formatAmount = (currency, n) =>
  `${currency}${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; // whole as before; cents always 2 places (2.90)

// Total rule: the sum only when there is at least one line and EVERY line has total > 0;
// otherwise the "to be confirmed" label stands in for the amount. `extra` (the shipping fee, > 0)
// is added to the sum; it never turns "to be confirmed" into an amount.
export function receiptTotalText(lines, currency, toBeConfirmed, extra = 0) {
  const allPriced = lines.length > 0 && lines.every((l) => Number(l.total) > 0);
  if (!allPriced) return { text: toBeConfirmed, allPriced };
  const add = Number(extra) > 0 ? Number(extra) : 0;
  const sum = lines.reduce((s, l) => s + Number(l.total), 0) + add;
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
  const IX = P + CARD_INSET, ICW = CW - CARD_INSET * 2; // inside the card
  const labels = input.labels || {};
  const ops = [];
  let y = P;
  const text = (t, x, font, align = "left", color = INK, extra) =>
    ops.push({ kind: "text", text: t, x, y, font, align, color, ...(extra || {}) });

  // Opening — above the card, as before.
  if (input.opening.trim()) {
    for (const l of wrapText(input.opening.trim(), CW, F.opening, measure)) { y += LH.opening; text(l, P, F.opening); }
    y += 18;
  }

  // CARD: drawn first (behind), its height is set once the total is laid out.
  const cardTop = y;
  const card = { kind: "box", x: P, y: cardTop, w: CW, h: 0, r: CARD_RADIUS, fill: CARD_FILL, stroke: RECEIPT_RULE_COLOR };
  ops.push(card);
  y += CARD_INSET;
  const header = `#${input.buyerNum} ${input.buyerName}`.trim();
  for (const l of wrapText(header, ICW, F.header, measure)) { y += LH.header; text(l, IX, F.header); }
  y += 16; ops.push({ kind: "rule", y, x0: IX, x1: IX + ICW }); y += 8;

  // Shipping fee: a row after the lines only when > 0 AND its label is given (else as before).
  const fee = Number(input.shippingFee) > 0 && labels.shipping ? Number(input.shippingFee) : 0;
  const shipH = fee ? 8 + 6 + LH.item + 6 : 0;

  // Everything after the lines is laid out first (only measured here), so the lines know how much
  // room is left under RECEIPT_MAX_HEIGHT.
  const { text: totalText, allPriced } = receiptTotalText(input.lines, input.currency, labels.toBeConfirmed, fee);
  const labelW = measure(labels.total, F.totalLabel);
  const amountFont = allPriced ? F.totalAmount : F.totalLabel;
  const amountLines = wrapText(totalText, Math.max(ICW - labelW - GAP, 80), amountFont, measure);
  const noteLines = input.note.trim() ? wrapText(input.note.trim(), CW, F.note, measure) : [];
  const howTo = noteLines.length && labels.howToPay ? String(labels.howToPay).toUpperCase() : "";
  let qrW = 0, qrH = 0;
  if (qrSize && qrSize.w > 0 && qrSize.h > 0) {
    qrW = Math.min(QR_MAX_WIDTH, CW, qrSize.w);
    qrH = Math.round((qrSize.h * qrW) / qrSize.w);
    if (qrH > QR_MAX_HEIGHT) { qrH = QR_MAX_HEIGHT; qrW = Math.max(1, Math.round((qrSize.w * qrH) / qrSize.h)); }
  }
  const scan = qrW && labels.scanToPay ? String(labels.scanToPay) : "";
  const tailH = shipH + 12 + amountLines.length * LH.total + CARD_INSET
    + (noteLines.length ? 22 + (howTo ? LH.label + 6 : 0) + noteLines.length * LH.note : 0)
    + (qrW ? 24 + qrH + (scan ? 4 + LH.label : 0) : 0) + P;
  const linesLimit = RECEIPT_MAX_HEIGHT - tailH - (LH.item + 6); // room kept for the "…and N more" row

  let shownLines = 0;
  for (let i = 0; i < input.lines.length; i++) {
    const ln = input.lines[i];
    const priced = Number(ln.total) > 0;
    const price = priced ? formatAmount(input.currency, Number(ln.total)) : "";
    const priceW = priced ? measure(price, F.price) : 0;
    const itemW = ICW - NUM_COL - (priced ? priceW + GAP : 0);
    const wrapped = wrapText(ln.item || "", Math.max(itemW, 40), F.item, measure);
    if (i >= RECEIPT_MAX_LINES || y + wrapped.length * LH.item + 6 > linesLimit) break;
    wrapped.forEach((l, j) => {
      y += LH.item;
      if (j === 0) {
        text(`${i + 1}.`, IX, F.num, "left", MUTED);
        if (priced) text(price, IX + ICW, F.price, "right");
      }
      text(l, IX + NUM_COL, F.item);
    });
    y += 6;
    shownLines++;
  }
  const hidden = input.lines.length - shownLines;
  if (hidden > 0) {
    y += LH.item;
    text(String(labels.more || MORE_LABEL_DEFAULT).replace("{n}", String(hidden)), IX + NUM_COL, F.item, "left", MUTED);
    y += 6;
  }

  if (fee) {
    y += 8;
    const tintTop = y;
    ops.push({ kind: "box", x: IX, y: tintTop, w: ICW, h: 6 + LH.item + 6, r: SHIP_RADIUS, fill: SHIP_TINT });
    y += 6 + LH.item;
    text(String(labels.shipping), IX + SHIP_PAD, F.item);
    text(formatAmount(input.currency, fee), IX + ICW - SHIP_PAD, F.price, "right");
    y += 6;
  }

  y += 6; ops.push({ kind: "rule", y, x0: IX, x1: IX + ICW }); y += 6;
  amountLines.forEach((l, j) => {
    y += LH.total;
    if (j === 0) text(labels.total, IX, F.totalLabel);
    text(l, IX + ICW, amountFont, "right", allPriced ? INK : MUTED);
  });
  y += CARD_INSET;
  card.h = y - cardTop;

  // Note + QR — below the card.
  if (noteLines.length) {
    y += 22;
    if (howTo) { y += LH.label; text(howTo, P, F.label, "left", MUTED, { letterSpacing: 2 }); y += 6; }
    for (const l of noteLines) { y += LH.note; text(l, P, F.note); }
  }
  if (qrW) {
    y += 24;
    ops.push({ kind: "image", x: Math.round((W - qrW) / 2), y, w: qrW, h: qrH });
    y += qrH;
    if (scan) { y += 4 + LH.label; text(scan, W / 2, F.label, "center", MUTED); }
  }
  return { width: W, height: Math.min(Math.ceil(y + P), RECEIPT_MAX_HEIGHT), ops, totalText, allPriced, hiddenLines: hidden };
}
