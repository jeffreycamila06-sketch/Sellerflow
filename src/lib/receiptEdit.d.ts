// Types for receiptEdit.js (the shared Facebook receipt edit → picture input).
import type { ReceiptInput, ReceiptLine } from "./receiptLayout.js";

export interface ReceiptEditLine { item: string; price: number | null }
export interface ReceiptEdit { opening: string; note: string; lines: ReceiptEditLine[]; shippingFee: number | null }
export declare const EDIT_MAX_LINES: number;
export declare const EDIT_ITEM_MAX: number;
export declare const EDIT_OPENING_MAX: number;
export declare const EDIT_NOTE_MAX: number;
export declare const EDIT_PRICE_MAX: number;
export declare function noEmoji(s: string): string;
export declare function cleanReceiptEdit(raw: unknown): ReceiptEdit;
export declare function editPictureLines(lines: unknown): ReceiptLine[];
export declare function applyReceiptEdit(base: ReceiptInput, raw: unknown): ReceiptInput;
