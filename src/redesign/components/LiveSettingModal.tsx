// LIVE SETTING MODAL — the explainer for Settings → Live session (approved clickable
// mockup). A CENTERED modal on every size (phone + desktop), not a bottom sheet.
// Shown only when a toggle is turned ON: it explains the setting, and the toggle
// flips ON only on the primary "Turn on". Cancel / click outside / Esc = keep it
// OFF (all route through onCancel).
//
// One small shared modal for all four rows (Keep awake, Auto-print pinned, Auto
// mode, Same price); Same price passes its price field as children. Portaled into
// the [data-redesign] root — same target as LiveSourceSheet — so the redesign
// tokens resolve and the fixed overlay escapes the screen's transformed entrance
// ancestor.
//
// Motion is CSS-only (redesign.css .sfl-lsm-*): fade + scale .96→1 over 200ms and a
// backdrop fade. The modal mounts on open, adds .show one frame later so the
// transition runs, and stays mounted ~210ms after close so the fade-out can play.
// prefers-reduced-motion turns the transitions off.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 210;

// requestAnimationFrame with a timer fallback (jsdom / very old WebViews).
const nextFrame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); }
  const id = setTimeout(cb, 16); return () => clearTimeout(id);
};

const head: CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 };
const iconBox: CSSProperties = { width: 44, height: 44, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const titleCss: CSSProperties = { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.25 };
const textCss: CSSProperties = { margin: "0 0 14px", fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)" };
const btnBase: CSSProperties = { border: 0, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 600, fontFamily: "var(--font-ui)", cursor: "pointer", width: "100%" };

export default function LiveSettingModal({
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
  onCancel: () => void;   // Cancel button, click outside and Esc
}) {
  const [mounted, setMounted] = useState(open);
  const [ready, setReady] = useState(false);
  if (open && !mounted) setMounted(true); // mount on open (render-time adjust, no effect)

  // One frame after mount → .show, so the fade/scale-in transition actually runs.
  useEffect(() => {
    if (!mounted || ready) return;
    let cancelInner = () => {};
    const cancelOuter = nextFrame(() => { cancelInner = nextFrame(() => setReady(true)); });
    return () => { cancelOuter(); cancelInner(); };
  }, [mounted, ready]);

  // Closed → keep it mounted for the fade-out, then unmount.
  useEffect(() => {
    if (open || !mounted) return;
    const id = setTimeout(() => { setMounted(false); setReady(false); }, EXIT_MS);
    return () => clearTimeout(id);
  }, [open, mounted]);

  // Esc closes while open. The latest onCancel is read through a ref (effect-mirrored)
  // so the listener is attached once per open, not re-bound every render.
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;
  const shown = open && ready;

  const node = (
    <div
      className={`sfl-lsm-backdrop${shown ? " show" : ""}`}
      style={{ pointerEvents: open ? "auto" : "none" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }} // click OUTSIDE the modal only
      data-testid="lsm-backdrop"
    >
      <div className="sfl-lsm-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="lsm-modal">
        <div style={head}>
          <div style={iconBox}>{icon}</div>
          <h2 style={titleCss}>{title}</h2>
        </div>
        <p style={textCss}>{text}</p>
        {children}
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={onPrimary} disabled={primaryDisabled} data-testid="lsm-turn-on"
            style={{ ...btnBase, background: "var(--accent)", color: "#fff", opacity: primaryDisabled ? 0.45 : 1, cursor: primaryDisabled ? "not-allowed" : "pointer" }}>
            {primaryLabel}
          </button>
          <button type="button" onClick={onCancel} data-testid="lsm-cancel" style={{ ...btnBase, background: "transparent", color: "var(--text-muted)" }}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.querySelector("[data-redesign]") || document.body);
}
