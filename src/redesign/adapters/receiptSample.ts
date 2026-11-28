// The sample receipt's picture input — ONE function for the Receipt format screen and the Invoicing
// "Facebook receipt format" sheet (the same buyer, the same three lines). shippingFee is only given by the
// sheet (the Invoicing shipping fee is added to every receipt sent from Invoicing); the screen passes none,
// so its input is exactly as before.
import type { ReceiptInput } from "./receiptImage";
import type { ReceiptSettings } from "./receiptSettings";

export function sampleReceiptInput(s: ReceiptSettings, cur: string, buyerName: string, labels: ReceiptInput["labels"], shippingFee?: number): ReceiptInput {
  return {
    opening: s.opening, note: s.note, qrImage: s.qrImage, currency: cur, buyerNum: 12, buyerName, labels,
    lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }, { item: "C3 ×2", total: 500 }],
    ...(shippingFee !== undefined && shippingFee > 0 ? { shippingFee } : {}),
  };
}
