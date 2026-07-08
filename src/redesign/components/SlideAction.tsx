// Shared "slide to <action>" pill — dark track, white knob + chevron, gradient
// fill, ~95% threshold, snap-back on early release. Touch + mouse (pointer
// events). Used by BOTH the update modal and the plan-expiry modal so the gesture
// lives in ONE place. Pure gesture math comes from adapters/nativeVersion.
import { useEffect, useRef, useState } from "react";
import { slideProgress, reachedThreshold } from "../adapters/nativeVersion";

const KNOB = 50; // px
const DEFAULT_TRACK = "#241f47";
const DEFAULT_FILL = "linear-gradient(90deg, var(--accent), var(--accent-2, #8b5cf6))";

const chevron = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default function SlideAction({
  label, doneLabel, onComplete, fill = DEFAULT_FILL, track = DEFAULT_TRACK, knobFg = "var(--accent-fg)", testid = "slide",
}: {
  label: string;
  doneLabel: string;
  onComplete: () => void;
  fill?: string;
  track?: string;
  knobFg?: string;
  testid?: string;
}) {
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
    const el = trackRef.current;
    if (!el || done) return;
    maxTravel.current = el.getBoundingClientRect().width - KNOB;
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
      if (reachedThreshold(progressRef.current)) { setProg(1); setDone(true); onComplete(); }
      else setProg(0); // snap back
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

  const knobLeft = `calc(${progress} * (100% - ${KNOB}px))`;
  return (
    <div ref={trackRef} data-testid={`${testid}-track`} style={{ position: "relative", height: KNOB + 6, borderRadius: 999, background: track, overflow: "hidden", userSelect: "none", touchAction: "none" }}>
      <div style={{ position: "absolute", inset: 0, width: `calc(${knobLeft} + ${KNOB}px)`, background: fill, opacity: 0.92, transition: dragging ? "none" : "width .25s ease", borderRadius: 999 }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13.5, fontWeight: 700, opacity: Math.max(0, 1 - progress * 1.4), pointerEvents: "none", letterSpacing: ".01em", padding: "0 12px", textAlign: "center" }}>
        {done ? doneLabel : label}
      </div>
      <div
        data-testid={`${testid}-knob`}
        role="button"
        aria-label={label}
        onPointerDown={(e) => begin(e.clientX)}
        style={{ position: "absolute", top: 3, left: knobLeft, width: KNOB, height: KNOB, borderRadius: "50%", background: "#fff", color: knobFg, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,.3)", cursor: "grab", transition: dragging ? "none" : "left .25s ease", touchAction: "none" }}
      >
        {chevron}
      </div>
    </div>
  );
}
