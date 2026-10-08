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
  labels: { total: string; toBeConfirmed: string };
}
export type Measure = (text: string, font: string) => number;
export type DrawOp =
  | { kind: "text"; text: string; x: number; y: number; font: string; align: "left" | "right" | "center"; color: string }
  | { kind: "rule"; y: number }
  | { kind: "image"; x: number; y: number; w: number; h: number };
export interface ReceiptLayout { width: number; height: number; ops: DrawOp[]; totalText: string; allPriced: boolean }
export declare const RECEIPT_WIDTH: number;
export declare const RECEIPT_PAD: number;
export declare const QR_MAX_WIDTH: number;
export declare const FONT_STACK: string;
export declare const RECEIPT_RULE_COLOR: string;
export declare function receiptFonts(stack?: string): Record<"opening" | "header" | "num" | "item" | "price" | "totalLabel" | "totalAmount" | "note", string>;
export declare const formatAmount: (currency: string, n: number) => string;
export declare function receiptTotalText(lines: ReceiptLine[], currency: string, toBeConfirmed: string): { text: string; allPriced: boolean };
export declare function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[];
export declare function layoutReceipt(input: ReceiptInput, measure: Measure, qrSize?: { w: number; h: number } | null, fontStack?: string): ReceiptLayout;
