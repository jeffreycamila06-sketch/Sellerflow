// LIVE SETTING SHEET — the bottom-sheet explainer for Settings → Live session
// (approved clickable mockup). Shown only when a toggle is turned ON: it slides up,
// explains the setting, and the toggle flips ON only on the primary "Turn on".
// Cancel / backdrop tap / swipe-down = keep it OFF (all route through onCancel).
//
// One small shared sheet for all four rows (Keep awake, Auto-print pinned, Auto mode,
// Same price); Same price passes its price field as children. Portaled into the
// [data-redesign] root — same target as LiveSourceSheet — so the redesign tokens
// resolve and the fixed overlay escapes the screen's transformed entrance ancestor.
//
// Motion is CSS-only (redesign.css .sfl-lss-*). The sheet mounts on open, adds .show
// one frame later so the slide-up transition runs, and stays mounted ~260ms after
// close so the slide-down can play. prefers-reduced-motion turns the transitions off.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 260;
const SWIPE_CLOSE_PX = 60;

// requestAnimationFrame with a timer fallback (jsdom / very old WebViews).
const nextFrame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); }
  const id = setTimeout(cb, 16); return () => clearTimeout(id);
};

const handle: CSSProperties = { width: 40, height: 5, borderRadius: 3, background: "var(--border-strong)", margin: "0 auto 14px" };
const head: CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 };
const iconBox: CSSProperties = { width: 44, height: 44, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const titleCss: CSSProperties = { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.25 };
const textCss: CSSProperties = { margin: "0 0 14px", fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)" };
const btnBase: CSSProperties = { border: 0, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 600, fontFamily: "var(--font-ui)", cursor: "pointer", width: "100%" };

export default function LiveSettingSheet({
  open, icon, title, text, children, primaryLabel, primaryDisabled = false, onPrimary, cancelLabel, onCancel,
}: {
  open: boolean;
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;   // extra content (Same price: the price field + hint)
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;  // "Turn on" — the ONLY path that flips the toggle ON
  cancelLabel: string;
  onCancel: () => void;   // Cancel button, backdrop tap and swipe-down
}) {
  const [mounted, setMounted] = useState(open);
  const [ready, setReady] = useState(false);
  if (open && !mounted) setMounted(true); // mount on open (render-time adjust, no effect)

  // One frame after mount → .show, so the slide-up transition actually runs.
  useEffect(() => {
    if (!mounted || ready) return;
    let cancelInner = () => {};
    const cancelOuter = nextFrame(() => { cancelInner = nextFrame(() => setReady(true)); });
    return () => { cancelOuter(); cancelInner(); };
  }, [mounted, ready]);

  // Closed → keep it mounted for the slide-down, then unmount.
  useEffect(() => {
    if (open || !mounted) return;
    const id = setTimeout(() => { setMounted(false); setReady(false); }, EXIT_MS);
    return () => clearTimeout(id);
  }, [open, mounted]);

  const touchY = useRef<number | null>(null);
  if (!mounted || typeof document === "undefined") return null;
  const shown = open && ready;

  const node = (
    <>
      <div className={`sfl-lss-backdrop${shown ? " show" : ""}`} style={{ pointerEvents: open ? "auto" : "none" }} onClick={onCancel} data-testid="lss-backdrop" />
      <div
        className={`sfl-lss-sheet${shown ? " show" : ""}`}
        role="dialog" aria-modal="true" aria-label={title} data-testid="lss-sheet"
        onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null; }}
        onTouchEnd={(e) => {
          const start = touchY.current; touchY.current = null;
          const end = e.changedTouches[0]?.clientY;
          if (start != null && end != null && end - start > SWIPE_CLOSE_PX) onCancel();
        }}
      >
        <div style={handle} />
        <div className="sfl-lss-body">
          <div style={head}>
            <div style={iconBox}>{icon}</div>
            <h2 style={titleCss}>{title}</h2>
          </div>
          <p style={textCss}>{text}</p>
          {children}
          <div style={{ display: "grid", gap: 8 }}>
            <button type="button" onClick={onPrimary} disabled={primaryDisabled} data-testid="lss-turn-on"
              style={{ ...btnBase, background: "var(--accent)", color: "#fff", opacity: primaryDisabled ? 0.45 : 1, cursor: primaryDisabled ? "not-allowed" : "pointer" }}>
              {primaryLabel}
            </button>
            <button type="button" onClick={onCancel} data-testid="lss-cancel" style={{ ...btnBase, background: "transparent", color: "var(--text-muted)" }}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
  return createPortal(node, document.querySelector("[data-redesign]") || document.body);
}
