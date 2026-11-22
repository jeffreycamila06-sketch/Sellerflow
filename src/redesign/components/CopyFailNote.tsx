// What a seller sees when the clipboard refused a Copy (adapters/buttonFeedback.ts): the line
// "Couldn't copy — press and hold the link to copy" and the text itself in a box, already selected.
// Nothing is shown unless a copy really failed. `floating`: drawn above the bottom bar (for Copy buttons
// inside a list, where there is no room under the button).
import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { selectAll, type CopyFeedback } from "../adapters/buttonFeedback";

type T = Record<string, string>;
export default function CopyFailNote({ fb, t, what = "text", floating = false, testid = "copy-fail", style }: {
  fb: CopyFeedback; t: T;
  /** which sentence: "…the link to copy" or "…the text to copy" */
  what?: "link" | "text"; floating?: boolean; testid?: string; style?: CSSProperties;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const failed = fb.phase === "failed";
  const text = fb.failedText;
  useEffect(() => { if (failed) selectAll(box.current); }, [failed, text]);
  if (!failed) return null;
  const rows = Math.min(4, Math.max(1, text.split("\n").length, Math.ceil(text.length / 44)));
  const note = (
    <div role="alert" data-testid={testid}
      style={{ border: "1.5px solid var(--danger)", borderRadius: 12, background: "var(--surface)", padding: "10px 12px", boxShadow: floating ? "0 10px 30px rgba(0,0,0,.28)" : "none", ...(floating ? null : { marginTop: 8 }), ...style }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, color: "var(--danger)" }}>{what === "link" ? t.rd_fb_copy_failed_link : t.rd_fb_copy_failed_text}</div>
        <button type="button" aria-label={t.rd_close} data-testid={`${testid}-close`} onClick={fb.clear}
          style={{ flexShrink: 0, width: 44, height: 44, margin: "-10px -10px -6px 0", border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: "pointer" }}>×</button>
      </div>
      <textarea ref={box} readOnly value={text} rows={rows} data-testid={`${testid}-text`} aria-label={what === "link" ? t.rd_fb_copy_failed_link : t.rd_fb_copy_failed_text}
        onFocus={(e) => selectAll(e.currentTarget)}
        style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, resize: "none", padding: "8px 10px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere", userSelect: "text", WebkitUserSelect: "text" }} />
    </div>
  );
  if (!floating) return note;
  // above the bottom bar and outside the screen's own stacking (a fixed layer inside a screen sits under the bar)
  const host = (typeof document !== "undefined" && (document.querySelector("[data-redesign]") as HTMLElement | null)) || (typeof document !== "undefined" ? document.body : null);
  if (!host) return note;
  return createPortal(
    <div style={{ position: "fixed", left: 0, right: 0, bottom: "calc(78px + env(safe-area-inset-bottom, 0px))", zIndex: 1300, padding: "0 max(12px, env(safe-area-inset-right, 0px)) 0 max(12px, env(safe-area-inset-left, 0px))", pointerEvents: "none" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", pointerEvents: "auto" }}>{note}</div>
    </div>, host);
}
