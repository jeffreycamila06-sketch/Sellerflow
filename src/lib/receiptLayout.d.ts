// Types for receiptLayout.js (the shared, pure receipt layout).
export interface ReceiptLine { item: string; total: number }
export interface ReceiptInput {
  opening: string;
  buyerName: string;
  buyerNum: number;
  lines: ReceiptLine[];
  currency: string;
  note: string;
  qrImage?: string | null;              // data URL of the seller's own QR picture
  shippingFee?: number;                 // > 0 (with labels.shipping) → a shipping row + added to the total
  // more: "…and {n} more" (Build 8). shipping / howToPay / scanToPay: card format; missing → that part as before.
  labels: { total: string; toBeConfirmed: string; more?: string; shipping?: string; howToPay?: string; scanToPay?: string };
}
export type Measure = (text: string, font: string) => number;
export type DrawOp =
  | { kind: "text"; text: string; x: number; y: number; font: string; align: "left" | "right" | "center"; color: string; letterSpacing?: number }
  | { kind: "rule"; y: number; x0?: number; x1?: number; thick?: number } // x0/x1 default to the content edges, thick to 2
  | { kind: "box"; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string } // stroke = 2 px
  | { kind: "image"; x: number; y: number; w: number; h: number };
export interface ReceiptLayout { width: number; height: number; ops: DrawOp[]; totalText: string; allPriced: boolean; hiddenLines: number }
export declare const RECEIPT_WIDTH: number;
export declare const RECEIPT_PAD: number;
export declare const QR_MAX_WIDTH: number;
export declare const RECEIPT_MAX_LINES: number;
export declare const RECEIPT_MAX_HEIGHT: number;
export declare const QR_MAX_HEIGHT: number;
export declare const MORE_LABEL_DEFAULT: string;
export declare const FONT_STACK: string;
export declare const RECEIPT_RULE_COLOR: string;
export declare function receiptFonts(stack?: string): Record<"opening" | "header" | "num" | "item" | "price" | "totalLabel" | "totalAmount" | "note" | "label", string>;
export declare const CARD_RADIUS: number;
export declare const CARD_INSET: number;
export declare const CARD_FILL: string;
export declare const SHIP_TINT: string;
export declare const SHIP_RADIUS: number;
export declare const SHIP_PAD: number;
export declare const formatAmount: (currency: string, n: number) => string;
export declare function receiptTotalText(lines: ReceiptLine[], currency: string, toBeConfirmed: string, extra?: number): { text: string; allPriced: boolean };
export declare function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[];
export declare function layoutReceipt(input: ReceiptInput, measure: Measure, qrSize?: { w: number; h: number } | null, fontStack?: string): ReceiptLayout;
