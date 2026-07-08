// "Time for an update" modal (OKX-style) — shown on a cold app open when the
// running native binary is older than the web-declared latest. NATIVE-only
// (RedesignApp gates it); web browsers never mount it. Slide-to-update pill opens
// the store. All copy is i18n ×7 and deliberately payment-free (iOS 3.1.1-safe).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import { resolveMessageKey, slideProgress, reachedThreshold } from "../adapters/nativeVersion";

// Self-contained control palette (OKX look): dark track in both themes, accent
// (theme-aware) fill, white knob. The card itself uses the design tokens.
const TRACK_BG = "#241f47";
const KNOB = 50; // px

const rocket = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M5 15c-1.5 1-2 4-2 4s3-.5 4-2m9.5-11.5C13 7 9.5 11 8 14l2 2c3-1.5 7-5 8.5-8.5.4-1 .5-2 .5-3 0 0-2 .1-3 .5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8.5 6.5C7 6 5.5 6.5 4.5 7.5L7 10M17.5 15.5c.5 1.5 0 3-1 4L14 17" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
const chevron = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default function UpdateModal({
  messageKey, force, onDismiss, onComplete,
}: {
  messageKey: string;
  force: boolean;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const msg = t[resolveMessageKey(messageKey)] ?? t.rd_upd_msg_generic;

  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const startX = useRef(0);
  const startProg = useRef(0);
  const maxTravel = useRef(0);

  const setProg = (v: number) => { progressRef.current = v; setProgress(v); };

  const begin = (clientX: number) => {
    const track = trackRef.current;
    if (!track || done) return;
    maxTravel.current = track.getBoundingClientRect().width - KNOB;
    startX.current = clientX;
    startProg.current = progressRef.current;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const travelled = startProg.current * maxTravel.current + (e.clientX - startX.current);
      setProg(slideProgress(travelled, maxTravel.current));
    };
    const onUp = () => {
      setDragging(false);
      if (reachedThreshold(progressRef.current)) {
        setProg(1);
        setDone(true);
        onComplete();
      } else {
        setProg(0); // snap back
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onComplete]);

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const knobLeft = `calc(${progress} * (100% - ${KNOB}px))`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_upd_title}>
      <div style={cardStyle} data-testid="update-modal">
        {!force && (
          <button onClick={onDismiss} aria-label={t.rd_upd_close} data-testid="update-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        )}
        <div style={{ width: 52, height: 52, borderRadius: 15, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{rocket}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_upd_title}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "8px 0 20px", lineHeight: 1.5 }}>{msg}</p>

        {/* slide-to-update */}
        <div
          ref={trackRef}
          data-testid="update-track"
          style={{ position: "relative", height: KNOB + 6, borderRadius: 999, background: TRACK_BG, overflow: "hidden", userSelect: "none", touchAction: "none" }}
        >
          {/* accent fill */}
          <div style={{ position: "absolute", inset: 0, width: `calc(${knobLeft} + ${KNOB}px)`, background: "linear-gradient(90deg, var(--accent), var(--accent-2, #8b5cf6))", opacity: 0.9, transition: dragging ? "none" : "width .25s ease", borderRadius: 999 }} />
          {/* label */}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13.5, fontWeight: 700, opacity: Math.max(0, 1 - progress * 1.4), pointerEvents: "none", letterSpacing: ".01em" }}>
            {done ? t.rd_upd_opening : t.rd_upd_slide}
          </div>
          {/* knob */}
          <div
            data-testid="update-knob"
            role="button"
            aria-label={t.rd_upd_slide}
            onPointerDown={(e) => begin(e.clientX)}
            style={{ position: "absolute", top: 3, left: knobLeft, width: KNOB, height: KNOB, borderRadius: "50%", background: "#fff", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,.3)", cursor: "grab", transition: dragging ? "none" : "left .25s ease", touchAction: "none" }}
          >
            {chevron}
          </div>
        </div>
      </div>
    </div>
  );
}
