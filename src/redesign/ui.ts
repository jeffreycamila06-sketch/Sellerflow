// Shared redesign style primitives (consume Phase 1 tokens). Keeps the P3
// screens consistent with the dc.html v2 card/header/section conventions.
import type { CSSProperties } from "react";

export const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
export const headerTitle: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
export const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)" };
export const sectionLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "0 4px 9px" };
export const mono = "var(--font-mono)";
