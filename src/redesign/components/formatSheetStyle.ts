import type { CSSProperties } from "react";

// The Invoicing format sheets' field look (TikTok invoice format, Facebook receipt format).
export const fsLabel: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", margin: "14px 2px 6px" };
export const fsField: CSSProperties = { boxSizing: "border-box", width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-ui)" };
export const fsHint: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", margin: "5px 2px 0", lineHeight: 1.4 };
export const fsSaveStyle: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", minHeight: 46, padding: "12px 0", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" };
