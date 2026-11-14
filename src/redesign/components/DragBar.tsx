// Pickup Status — the screen's own drag bar (iPhone, Android, iPad, laptop): a fixed thumb on
// the right edge that follows the page scroll and can be dragged, so a long parcel list is
// quick to move through on a phone (the WebView has no grabbable scrollbar). Used only in
// ParcelTracking. It only READS the page position and calls window.scrollTo — nothing in the
// list, pager or filter changes. While mounted the browser's own page scrollbar is hidden
// (html class "pt-dragbar", see redesign.css); the class goes away on unmount.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

const THUMB = 56;       // thumb height (touch area)
const GAP_TOP = 6;      // below the sticky header
const GAP_BOTTOM = 8;   // + env(safe-area-inset-bottom) in CSS
export const DRAGBAR_HTML_CLASS = "pt-dragbar";

interface Geo { visible: boolean; barTop: number; barH: number; max: number; thumbTop: number; pct: number }
const HIDDEN: Geo = { visible: false, barTop: 0, barH: 0, max: 0, thumbTop: 0, pct: 0 };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export default function DragBar({ headerRef, dep, label }: { headerRef: RefObject<HTMLElement | null>; dep?: unknown; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo>(HIDDEN);
  const [dragging, setDragging] = useState(false);
  const grab = useRef(0); // pointer offset inside the thumb at pointerdown

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    const doc = document.documentElement;
    const max = Math.max(0, (doc.scrollHeight || 0) - window.innerHeight);
    if (max <= 0) { setGeo(HIDDEN); return; }
    const head = headerRef.current;
    const barTop = (head ? Math.max(0, head.getBoundingClientRect().bottom) : 0) + GAP_TOP;
    const measured = trackRef.current?.getBoundingClientRect().height ?? 0;
    const barH = measured > 0 ? measured : Math.max(0, window.innerHeight - barTop - GAP_BOTTOM);
    const f = clamp01(window.scrollY / max);
    setGeo({ visible: barH > THUMB, barTop, barH, max, thumbTop: f * Math.max(0, barH - THUMB), pct: Math.round(f * 100) });
  }, [headerRef]);

  // Hide the browser's own page scrollbar only while this screen is open.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(DRAGBAR_HTML_CLASS);
    return () => html.classList.remove(DRAGBAR_HTML_CLASS);
  }, []);

  // Follow the page: scroll (passive), resize, the body growing (names / rows), and every
  // list change the screen reports through `dep` (page / filter / tab / search / sync).
  useEffect(() => {
    const raf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : (cb: () => void) => window.setTimeout(cb, 0);
    const cancel = typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout.bind(window);
    const id = raf(measure);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    ro?.observe(document.body);
    return () => { cancel(id as number); window.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [measure, dep]);

  const scrollToFraction = (f: number) => {
    window.scrollTo(0, clamp01(f) * geo.max);
  };
  const fractionAt = (clientY: number, offset: number) => {
    const span = geo.barH - THUMB;
    return span > 0 ? (clientY - offset - geo.barTop) / span : 0;
  };

  const onThumbDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    grab.current = e.clientY - (geo.barTop + geo.thumbTop);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* best-effort */ }
    setDragging(true);
  };
  const onThumbMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.preventDefault();
    scrollToFraction(fractionAt(e.clientY, grab.current));
  };
  const onThumbUp = (e: RPointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* best-effort */ }
    setDragging(false); // the page stays where it is
  };
  // A tap on the track (not the thumb) jumps there: the thumb's middle lands on the tap.
  const onTrackDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    scrollToFraction(fractionAt(e.clientY, THUMB / 2));
  };

  const pill = dragging ? 12 : 10;
  const node = (
    <div ref={trackRef} data-testid="pt-dragbar" onPointerDown={onTrackDown}
      style={{
        position: "fixed", right: 0, width: 28, top: geo.barTop || GAP_TOP, bottom: `calc(${GAP_BOTTOM}px + env(safe-area-inset-bottom))`,
        zIndex: 20, touchAction: "none", visibility: geo.visible ? "visible" : "hidden", pointerEvents: geo.visible ? "auto" : "none",
      }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, right: 4, width: 8, borderRadius: 4, background: "var(--border)", pointerEvents: "none" }} />
      <div role="scrollbar" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={geo.pct} aria-label={label}
        data-testid="pt-dragbar-thumb" data-dragging={dragging ? "1" : "0"}
        onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
        style={{ position: "absolute", right: 0, width: 28, height: THUMB, top: geo.thumbTop, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 8 - pill / 2, width: pill, borderRadius: pill / 2,
          background: dragging ? "var(--accent)" : "var(--text-muted)", opacity: dragging ? 1 : 0.6,
          boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "width .12s, right .12s, background .12s",
        }} />
      </div>
    </div>
  );
  if (!geo.visible && !dragging) return createPortal(<div data-testid="pt-dragbar-off" hidden />, portalRoot());
  return createPortal(node, portalRoot());
}

// Inside [data-redesign] so the theme tokens resolve (a body portal would lose them).
function portalRoot(): Element {
  return (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body;
}
