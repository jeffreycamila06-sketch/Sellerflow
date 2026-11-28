import type { CSSProperties } from "react";

/** The Receipt format screen's buttons (also the QR picture buttons in ReceiptFormatParts). */
export const rcBtn = (primary: boolean): CSSProperties => ({ padding: "9px 15px", borderRadius: 10, border: primary ? "none" : "1px solid var(--border-strong)", background: primary ? "var(--accent)" : "var(--surface-2)", color: primary ? "var(--accent-text)" : "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" });
