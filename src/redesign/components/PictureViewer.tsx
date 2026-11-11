// Full-screen picture viewer (Products, approved preview Nov 12 2026). Dark overlay over
// everything, the WHOLE picture (contain), the product name at the bottom, ✕ top-right.
// Closes with ✕, a tap outside the picture, Esc, or the phone back gesture (a history entry is
// added while open; Android back / browser back pops it). Safe-area aware. Focus goes to ✕ while
// open and back to the element that opened it when closed.
import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const MARK = "sflPicViewer";

export default function PictureViewer({ src, caption, closeLabel, opener, onClose }: {
  src: string;
  caption: string;
  closeLabel: string;
  opener?: HTMLElement | null; // focus returns here on close
  onClose: () => void;
}) {
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let pushed = false;
    let popped = false;
    try { window.history.pushState({ [MARK]: true }, ""); pushed = true; } catch { /* no history (rare) */ }
    const onPop = () => { popped = true; onCloseRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); onCloseRef.current(); } };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    try { closeBtn.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      // Closed another way (✕ / outside / Esc / screen left): take our history entry off again so
      // the next back gesture does what it did before the viewer opened.
      if (pushed && !popped) {
        try { if ((window.history.state as Record<string, unknown> | null)?.[MARK]) window.history.back(); } catch { /* ignore */ }
      }
      try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch { /* ignore */ }
    };
  }, [opener]);

  const overlay: CSSProperties = {
    position: "fixed", inset: 0, zIndex: 2000, background: "rgba(5,5,10,.94)", display: "flex", flexDirection: "column",
    padding: "calc(env(safe-area-inset-top) + 64px) calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 16px) calc(env(safe-area-inset-left) + 12px)",
    boxSizing: "border-box", fontFamily: "var(--font-ui)",
  };
  const node = (
    <div role="dialog" aria-modal="true" aria-label={caption} data-testid="pic-viewer" onClick={() => onClose()} style={overlay}>
      <button ref={closeBtn} type="button" aria-label={closeLabel} data-testid="pic-viewer-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{ position: "absolute", top: "calc(env(safe-area-inset-top) + 12px)", right: "calc(env(safe-area-inset-right) + 12px)", width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 18, fontWeight: 700, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src={src} alt={caption} data-testid="pic-viewer-img" onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12, display: "block" }} />
      </div>
      <div data-testid="pic-viewer-caption" style={{ color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center", lineHeight: 1.35, padding: "12px 8px 0", overflowWrap: "anywhere" }}>{caption}</div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
