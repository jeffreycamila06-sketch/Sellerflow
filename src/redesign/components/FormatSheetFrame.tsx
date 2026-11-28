// The bottom sheet both Invoicing format sheets use (TikTok invoice format, Facebook receipt format):
// handle bar, title + Close, a scrolling body, the Save button stuck at the bottom. Drawn in a portal into
// [data-redesign] (above the bottom bar).
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

export default function FormatSheetFrame({ title, testid, onClose, footer, children }: {
  title: string; testid: string; onClose: () => void; footer: ReactNode; children: ReactNode;
}) {
  const t = useT();
  const node = (
    <div onClick={onClose} data-testid={`${testid}-overlay`} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title} data-testid={`${testid}-sheet`}
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 14px 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span data-testid={`${testid}-title`} style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", minWidth: 0, overflowWrap: "anywhere" }}>{title}</span>
            <button type="button" data-testid={`${testid}-close`} onClick={onClose}
              style={{ marginLeft: "auto", flexShrink: 0, minHeight: 44, padding: "0 4px 0 12px", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_close}</button>
          </div>
          {children}
        </div>
        <div style={{ flex: "0 0 auto", padding: "10px 14px calc(18px + env(safe-area-inset-bottom))" }}>{footer}</div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
